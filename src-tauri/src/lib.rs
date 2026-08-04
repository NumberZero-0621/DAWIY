use tauri::command;
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

#[command]
fn open_vst_editor(path: String, sample_rate: f32, visible: Option<bool>) -> Result<u32, String> {
    vst_host::load_and_open(path, sample_rate, visible.unwrap_or(true), None)
}

#[command]
fn hide_vst_editor(instance_id: u32) -> Result<(), String> {
    vst_host::hide_window(instance_id)
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
fn get_vst_parameters(instance_id: u32) -> Result<Vec<vst_host::VstParameterInfo>, String> {
    vst_host::get_parameters(instance_id)
}

#[command]
fn get_vst_parameter(instance_id: u32, param_id: u32) -> Result<f64, String> {
    vst_host::get_parameter(instance_id, param_id)
}

#[command]
fn set_vst_parameter(instance_id: u32, param_id: u32, value: f64) -> Result<(), String> {
    vst_host::set_parameter(instance_id, param_id, value)
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
        get_vst_parameters,
        get_vst_parameter,
        set_vst_parameter,
        midi::list_midi_outputs,
        midi::open_midi_output,
        midi::close_midi_output,
        midi::send_midi_message,
        hide_vst_editor
    ])
    .on_window_event(|_window, event| {
        match event {
            tauri::WindowEvent::Focused(focused) => {
                // DAWIY本体がフォーカスを得たときだけVSTを最前面にする
                let _ = vst_host::set_all_vst_topmost(*focused);
            }
            tauri::WindowEvent::Resized(_) => {
                // DAWIY本体の最小化状態をチェックしてVSTの表示を切り替える
                if let Ok(minimized) = _window.is_minimized() {
                    let _ = vst_host::set_all_vst_visible(!minimized);
                }
            }
            tauri::WindowEvent::CloseRequested { .. } => {
                println!("[TAURI] Window Close Requested. Cleaning up...");
            }
            _ => {}
        }
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}

