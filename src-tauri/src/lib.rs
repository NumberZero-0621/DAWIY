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
    let vst_dir = r"C:\Program Files\Common Files\VST3";
    let path = Path::new(vst_dir);

    if !path.exists() {
        return plugins;
    }

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
                // Check if it's a directory (bundle)
                else if path.is_dir() {
                     if let Some(ext) = path.extension() {
                        if ext == "vst3" {
                            let name = path.file_stem().unwrap().to_string_lossy().to_string();
                            let binary_path = path.join("Contents").join("x86_64-win").join(&name).with_extension("vst3");
                             if binary_path.exists() && try_load_vst(&binary_path) {
                                plugins.push(VstPlugin {
                                    name: name,
                                    path: binary_path.to_string_lossy().to_string(),
                                    vendor: "VST3".to_string(),
                                });
                            }
                        }
                    }
                }
            }
        }
    }
    
    plugins
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

#[command]
fn open_vst_editor(path: String) -> Result<(), String> {
    vst_host::load_and_open(path)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_log::Builder::default().build())
    .invoke_handler(tauri::generate_handler![scan_plugins, open_vst_editor])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
