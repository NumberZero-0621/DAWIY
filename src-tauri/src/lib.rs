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
fn scan_plugins() -> Vec<VstPlugin> {
    let mut plugins = Vec::new();
    let vst_dirs = vec![
        r"C:\Program Files\Common Files\VST3",
        r"C:\Program Files (x86)\Common Files\VST3",
        r"C:\Program Files (x86)\Steinberg",
        r"C:\Program Files (x86)\VstPlugins",
        r"C:\Program Files\Cakewalk\VstPlugins",
        r"C:\Program Files\Steinberg",
        r"C:\Program Files\VstPlugins",
    ];

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
mod carla_host;  // Carla統合モジュール（Windows非対応のため使用停止）
mod vst_launcher;
mod midi;  // スタンドアロンVST起動モジュール

#[command]
fn open_vst_editor(path: String) -> Result<(), String> {
    vst_host::load_and_open(path)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_log::Builder::default().build())
    .plugin(tauri_plugin_dialog::init())
    .invoke_handler(tauri::generate_handler![
        scan_plugins, 
        open_vst_editor,
        carla_host::open_vst_with_carla,
        carla_host::stop_carla,
        vst_launcher::launch_vst_standalone,
        vst_launcher::stop_all_vst,
        vst_launcher::launch_executable,
        midi::list_midi_outputs,
        midi::open_midi_output,
        midi::close_midi_output,
        midi::send_midi_message
    ])
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

