use tauri::{command, Manager};
use std::path::Path;
use std::ffi::c_void;
use libloading::{Library, Symbol};
use std::fs;

// Signature of the GetPluginFactory function exported by VST3 plugins.
type GetPluginFactory = unsafe extern "system" fn(factory: *mut *mut c_void) -> i32;

#[derive(serde::Serialize, Clone)]
struct VstPlugin {
    name: String,
    path: String,
    vendor: String,
}

#[command]
fn scan_plugins(custom_paths: Vec<String>) -> Vec<VstPlugin> {
    let mut plugins = Vec::new();
    let mut vst_dirs = Vec::new();

    for custom in custom_paths {
        vst_dirs.push(Box::leak(custom.into_boxed_str()));
    }

    for vst_dir in vst_dirs {
        let path = Path::new(vst_dir);
        if path.exists() {
            scan_dir_recursive(path, &mut plugins);
        }
    }
    
    plugins
}

fn scan_dir_recursive(path: &Path, plugins: &mut Vec<VstPlugin>) {
    if let Ok(entries) = fs::read_dir(path) {
        for entry in entries {
            if let Ok(entry) = entry {
                let path = entry.path();
                // Check if it's a file ending in .vst3
                if path.is_file() {
                    if let Some(ext) = path.extension() {
                        if ext == "vst3" {
                            if try_load_vst(&path) {
                                let name = path.file_stem().unwrap().to_string_lossy().to_string();
                                plugins.push(VstPlugin {
                                    name: name.clone(),
                                    path: path.to_string_lossy().to_string(),
                                    vendor: "VST3".to_string(),
                                });
                            }
                        }
                    }
                } 
                // Check if it's a directory
                else if path.is_dir() {
                    let is_bundle = path.extension().map_or(false, |ext| ext == "vst3");
                    
                    if is_bundle {
                         // Bundle logic: Check for Contents/x86_64-win/{name}.vst3
                        let name = path.file_stem().unwrap().to_string_lossy().to_string();
                        let binary_path = path.join("Contents").join("x86_64-win").join(&name).with_extension("vst3");
                        
                        if binary_path.exists() && try_load_vst(&binary_path) {
                            plugins.push(VstPlugin {
                                name: name,
                                path: binary_path.to_string_lossy().to_string(),
                                vendor: "VST3".to_string(),
                            });
                        }
                    } else {
                        // Normal directory: Recurse
                        scan_dir_recursive(&path, plugins);
                    }
                }
            }
        }
    }
}

fn try_load_vst(path: &Path) -> bool {
    unsafe {
        let lib = match Library::new(path) {
            Ok(l) => l,
            Err(_) => return false,
        };

        // Try to find the entry point
        let _: Symbol<GetPluginFactory> = match lib.get(b"GetPluginFactory") {
            Ok(f) => f,
            Err(_) => return false,
        };
        
        return true;
    }
}


mod vst_host;
mod midi;  // スタンドアロンVST起動モジュール
mod mixer;
mod audio_engine; // Rustネイティブオーディオエンジン

#[command]
fn open_vst_editor(path: String, sample_rate: f32) -> Result<u32, String> {
    vst_host::load_and_open(path, sample_rate)
}

#[command]
fn close_vst_editor(instance_id: u32) -> Result<(), String> {
    vst_host::close_editor(instance_id)
}

#[command]
fn close_all_vst_editors() -> Result<(), String> {
    vst_host::close_all_editors()
}

#[command]
fn show_vst_editor(instance_id: u32) -> Result<(), String> {
    vst_host::show_window(instance_id)
}

#[command]
fn send_vst_midi(instance_id: u32, status: u8, data1: u8, data2: u8) -> Result<(), String> {
    vst_host::send_midi(instance_id, status, data1, data2)
}

#[command]
fn get_vst_audio(instance_id: u32, req_samples: usize) -> Result<tauri::ipc::Response, String> {
    let (out_l, out_r) = vst_host::get_audio(instance_id, req_samples)?;
    
    // Float32のバイナリ表現としてシリアライズする
    // フォーマット: [サンプル数(u32)], [Lチャンネル...], [Rチャンネル...]
    let samples = out_l.len() as u32;
    let mut bytes = Vec::with_capacity(4 + (out_l.len() + out_r.len()) * 4);
    
    bytes.extend_from_slice(&samples.to_le_bytes());
    
    let l_bytes: &[u8] = unsafe { std::slice::from_raw_parts(out_l.as_ptr() as *const u8, out_l.len() * 4) };
    bytes.extend_from_slice(l_bytes);
    
    let r_bytes: &[u8] = unsafe { std::slice::from_raw_parts(out_r.as_ptr() as *const u8, out_r.len() * 4) };
    bytes.extend_from_slice(r_bytes);
    
    Ok(tauri::ipc::Response::new(bytes))
}

#[command]
fn process_vst_audio(instance_id: u32, req_samples: usize, input_l_bytes: Vec<u8>, input_r_bytes: Vec<u8>) -> Result<tauri::ipc::Response, String> {
    // Convert Vec<u8> to Vec<f32>
    let in_l_f32: Vec<f32> = {
        let ptr = input_l_bytes.as_ptr() as *const f32;
        let len = input_l_bytes.len() / 4;
        unsafe { std::slice::from_raw_parts(ptr, len).to_vec() }
    };
    
    let in_r_f32: Vec<f32> = {
        let ptr = input_r_bytes.as_ptr() as *const f32;
        let len = input_r_bytes.len() / 4;
        unsafe { std::slice::from_raw_parts(ptr, len).to_vec() }
    };

    let (out_l, out_r) = vst_host::process_audio(instance_id, req_samples, in_l_f32, in_r_f32)?;
    
    let samples = out_l.len() as u32;
    let mut bytes = Vec::with_capacity(4 + (out_l.len() + out_r.len()) * 4);
    
    bytes.extend_from_slice(&samples.to_le_bytes());
    
    let l_bytes: &[u8] = unsafe { std::slice::from_raw_parts(out_l.as_ptr() as *const u8, out_l.len() * 4) };
    bytes.extend_from_slice(l_bytes);
    
    let r_bytes: &[u8] = unsafe { std::slice::from_raw_parts(out_r.as_ptr() as *const u8, out_r.len() * 4) };
    bytes.extend_from_slice(r_bytes);
    
    Ok(tauri::ipc::Response::new(bytes))
}

#[command]
fn add_track(state: tauri::State<'_, std::sync::Arc<std::sync::Mutex<mixer::Mixer>>>, track_id: u32) {
    if let Ok(mut mixer) = state.lock() {
        mixer.add_track(track_id);
    }
}

#[command]
fn set_track_vst(state: tauri::State<'_, std::sync::Arc<std::sync::Mutex<mixer::Mixer>>>, track_id: u32, vst_id: u32) {
    if let Ok(mut mixer) = state.lock() {
        mixer.set_track_vst(track_id, vst_id);
    }
}

#[command]
fn play_midi_note(state: tauri::State<'_, std::sync::Arc<std::sync::Mutex<mixer::Mixer>>>, track_id: u32, status: u8, data1: u8, data2: u8) {
    if let Ok(mut mixer) = state.lock() {
        mixer.send_midi(track_id, status, data1, data2);
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_log::Builder::default().build())
    .plugin(tauri_plugin_dialog::init())
    .invoke_handler(tauri::generate_handler![
        scan_plugins,            open_vst_editor,
            close_vst_editor,
            close_all_vst_editors,
            show_vst_editor,
            send_vst_midi,
        get_vst_audio,
        process_vst_audio,
        add_track,
        set_track_vst,
        play_midi_note,
        midi::list_midi_outputs,
        midi::open_midi_output,
        midi::close_midi_output,
        midi::send_midi_message
    ])
    .setup(|app| {
        let mixer = std::sync::Arc::new(std::sync::Mutex::new(mixer::Mixer::new()));
        app.manage(mixer.clone());

        // スタートアップ時にオーディオエンジンを起動（一旦テスト用）
        match audio_engine::AudioEngineHandle::new(mixer) {
            Ok(handle) => {
                // アプリケーションの状態として保持（将来的に外部から操作するため）
                app.manage(std::sync::Mutex::new(handle));
            }
            Err(e) => {
                log::error!("Failed to start audio engine: {}", e);
            }
        }
        Ok(())
    })
    .on_window_event(|window, event| {
        match event {
            tauri::WindowEvent::CloseRequested { .. } => {
                println!("[TAURI] Window Close Requested (Label: {}). Cleaning up...", window.label());
            }
            tauri::WindowEvent::Destroyed => {
                println!("[TAURI] Window Destroyed (Label: {}).", window.label());
            }
            _ => {}
        }
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}

