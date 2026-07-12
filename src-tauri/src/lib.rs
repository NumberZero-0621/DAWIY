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
mod audio_loader;
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

    let (out_l, out_r) = vst_host::process_audio(instance_id, req_samples, in_l_f32, in_r_f32, false, false, 0)?;
    
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
fn add_audio_buffer(state: tauri::State<'_, std::sync::Arc<std::sync::Mutex<mixer::Mixer>>>, buffer_id: u32, left_bytes: Vec<u8>, right_bytes: Vec<u8>) {
    let left: Vec<f32> = {
        let ptr = left_bytes.as_ptr() as *const f32;
        let len = left_bytes.len() / 4;
        unsafe { std::slice::from_raw_parts(ptr, len).to_vec() }
    };
    let right: Vec<f32> = {
        let ptr = right_bytes.as_ptr() as *const f32;
        let len = right_bytes.len() / 4;
        unsafe { std::slice::from_raw_parts(ptr, len).to_vec() }
    };
    
    if let Ok(mut mixer) = state.lock() {
        mixer.add_audio_buffer(buffer_id, left, right);
    }
}

#[derive(serde::Deserialize)]
struct JsRegion {
    buffer_id: u32,
    start_samples: f64,
    length_samples: f64,
    offset_samples: f64,
}

#[derive(serde::Deserialize)]
struct JsMidiEvent {
    sample_time: u64,
    status: u8,
    data1: u8,
    data2: u8,
}

#[derive(Clone, serde::Serialize, serde::Deserialize)]
struct ProgressPayload {
    loaded: usize,
    total: usize,
}

#[command]
async fn load_audio_file(
    state: tauri::State<'_, std::sync::Arc<std::sync::Mutex<mixer::Mixer>>>, 
    buffer_id: u32, 
    path: String,
    on_progress: tauri::ipc::Channel<ProgressPayload>,
) -> Result<audio_loader::AudioFileInfo, String> {
    // Resolve URL-like paths
    let mut real_path = path;
    if real_path.starts_with("http://localhost:6002/") {
        let relative = real_path.replace("http://localhost:6002/", "");
        // Resolve to bank directory
        let current_dir = std::env::current_dir().unwrap_or_else(|_| std::path::PathBuf::from("."));
        // Depending on where DAWIY is launched (src-tauri vs root), we might need to find bank/
        let mut bank_path = current_dir.clone();
        if bank_path.ends_with("src-tauri") {
            bank_path.pop();
        }
        bank_path.push("bank");
        bank_path.push(relative);
        real_path = bank_path.to_string_lossy().to_string();
    }
    
    let target_sample_rate = if let Ok(mixer) = state.lock() { mixer.sample_rate } else { 48000 };
    
    // Background execution via spawn_blocking prevents blocking Tauri's async executor thread
    let (info, left, right) = tauri::async_runtime::spawn_blocking(move || {
        audio_loader::decode_file(&real_path, buffer_id, target_sample_rate, |loaded, total| {
            let _ = on_progress.send(ProgressPayload { loaded, total });
        })
    }).await.map_err(|e| format!("Task failed: {}", e))??;
    
    if let Ok(mut mixer) = state.lock() {
        mixer.add_audio_buffer(buffer_id, left, right);
    }
    Ok(info)
}

#[command]
async fn load_audio_from_memory(
    state: tauri::State<'_, std::sync::Arc<std::sync::Mutex<mixer::Mixer>>>, 
    buffer_id: u32, 
    data: Vec<u8>,
    on_progress: tauri::ipc::Channel<ProgressPayload>,
) -> Result<audio_loader::AudioFileInfo, String> {
    let target_sample_rate = if let Ok(mixer) = state.lock() { mixer.sample_rate } else { 48000 };
    let (info, left, right) = audio_loader::decode_memory(data, buffer_id, target_sample_rate, |loaded, total| {
        let _ = on_progress.send(ProgressPayload { loaded, total });
    })?;
    if let Ok(mut mixer) = state.lock() {
        mixer.add_audio_buffer(buffer_id, left, right);
    }
    Ok(info)
}

#[command]
fn read_file_bytes(path: String) -> Result<tauri::ipc::Response, String> {
    match std::fs::read(&path) {
        Ok(bytes) => Ok(tauri::ipc::Response::new(bytes)),
        Err(e) => Err(e.to_string())
    }
}

#[command]
fn update_track_regions(
    state: tauri::State<'_, std::sync::Arc<std::sync::Mutex<mixer::Mixer>>>, 
    track_id: u32, 
    regions: Vec<JsRegion>,
    midi_events: Option<Vec<JsMidiEvent>>
) {
    if let Ok(mut mixer) = state.lock() {
        let rust_regions = regions.into_iter().map(|r| mixer::Region {
            buffer_id: r.buffer_id,
            start_samples: r.start_samples as u64,
            length_samples: r.length_samples as u64,
            offset_samples: r.offset_samples as u64,
        }).collect();
        mixer.update_track_regions(track_id, rust_regions);
        
        if let Some(events) = midi_events {
            println!("[update_track_regions] Track {}: Received {} midi events", track_id, events.len());
            if let Some(track) = mixer.tracks.get_mut(&track_id) {
                track.midi_sequence = events.into_iter().map(|e| (e.sample_time, e.status, e.data1, e.data2)).collect();
            }
        } else {
            println!("[update_track_regions] Track {}: Received None for midi events", track_id);
            // Optionally clear if None is received?
            // if let Some(track) = mixer.tracks.get_mut(&track_id) {
            //     track.midi_sequence.clear();
            // }
        }
    }
}

#[command]
fn add_track(state: tauri::State<'_, std::sync::Arc<std::sync::Mutex<mixer::Mixer>>>, track_id: u32) {
    if let Ok(mut mixer) = state.lock() {
        // Just initializes the track with default values
        mixer.set_track_volume(track_id, 1.0);
    }
}

#[command]
fn remove_track(state: tauri::State<'_, std::sync::Arc<std::sync::Mutex<mixer::Mixer>>>, track_id: u32) {
    if let Ok(mut mixer) = state.lock() {
        mixer.remove_track(track_id);
    }
}

#[command]
fn set_track_volume(state: tauri::State<'_, std::sync::Arc<std::sync::Mutex<mixer::Mixer>>>, track_id: u32, volume: f32) {
    if let Ok(mut mixer) = state.lock() {
        mixer.set_track_volume(track_id, volume);
    }
}

#[command]
fn set_track_pan(state: tauri::State<'_, std::sync::Arc<std::sync::Mutex<mixer::Mixer>>>, track_id: u32, pan: f32) {
    if let Ok(mut mixer) = state.lock() {
        mixer.set_track_pan(track_id, pan);
    }
}

#[command]
fn set_track_vsts(state: tauri::State<'_, std::sync::Arc<std::sync::Mutex<mixer::Mixer>>>, track_id: u32, vst_ids: Vec<u32>) {
    if let Ok(mut mixer) = state.lock() {
        mixer.set_track_vsts(track_id, vst_ids);
    }
}

#[command]
fn play_midi_note(state: tauri::State<'_, std::sync::Arc<std::sync::Mutex<mixer::Mixer>>>, track_id: u32, status: u8, data1: u8, data2: u8) {
    if let Ok(mut mixer) = state.lock() {
        mixer.add_midi_event(track_id, status, data1, data2);
    }
}

#[command]
fn host_play(state: tauri::State<'_, std::sync::Arc<std::sync::Mutex<mixer::Mixer>>>) {
    if let Ok(mut mixer) = state.lock() {
        mixer.is_playing = true;
    }
}

#[command]
fn host_pause(state: tauri::State<'_, std::sync::Arc<std::sync::Mutex<mixer::Mixer>>>) {
    if let Ok(mut mixer) = state.lock() {
        mixer.is_playing = false;
    }
}

#[command]
fn host_set_playhead(state: tauri::State<'_, std::sync::Arc<std::sync::Mutex<mixer::Mixer>>>, playhead_ms: f64) {
    if let Ok(mut mixer) = state.lock() {
        let sample_rate = mixer.sample_rate as f64;
        mixer.playhead_samples = ((playhead_ms / 1000.0) * sample_rate) as u64;
    }
}

#[command]
async fn bounce_offline(state: tauri::State<'_, std::sync::Arc<std::sync::Mutex<mixer::Mixer>>>, max_duration_samples: u32, track_ids: Option<Vec<u32>>) -> Result<tauri::ipc::Response, String> {
    let mixer_arc = state.inner().clone();
    
    // Background execution via spawn_blocking prevents blocking Tauri's async executor thread
    let (out_l, out_r) = tauri::async_runtime::spawn_blocking(move || {
        let mut out_l = Vec::with_capacity(max_duration_samples as usize);
        let mut out_r = Vec::with_capacity(max_duration_samples as usize);

        if let Ok(mut mixer) = mixer_arc.lock() {
            // Save state
            let orig_playing = mixer.is_playing;
            let orig_offline = mixer.is_offline_render;
            let orig_playhead = mixer.playhead_samples;
            
            let mut orig_muted = std::collections::HashMap::new();
            for (id, track) in &mixer.tracks {
                orig_muted.insert(*id, track.is_muted);
            }

            // Apply offline settings
            mixer.is_playing = true;
            mixer.is_offline_render = true;
            mixer.playhead_samples = 0;

            if let Some(ids) = &track_ids {
                for (id, track) in &mut mixer.tracks {
                    if !ids.contains(id) {
                        track.is_muted = true;
                    }
                }
            }

            let chunk_size = 512;
            let mut samples_processed = 0;
            let mut buffer = vec![0.0; chunk_size * 2]; // Stereo

            for (id, track) in &mixer.tracks {
                println!("[bounce_offline] Track {}: muted={}, vsts={:?}, regions={}, midi_len={}", id, track.is_muted, track.vst_instances, track.regions.len(), track.midi_sequence.len());
            }

            while samples_processed < max_duration_samples {
                let to_process = std::cmp::min(chunk_size as u32, max_duration_samples - samples_processed) as usize;
                let buffer_slice = &mut buffer[..to_process * 2];
                
                mixer.process(buffer_slice, 2);

                for i in 0..to_process {
                    out_l.push(buffer_slice[i * 2]);
                    out_r.push(buffer_slice[i * 2 + 1]);
                }
                samples_processed += to_process as u32;
            }

            // Restore state
            mixer.is_playing = orig_playing;
            mixer.is_offline_render = orig_offline;
            mixer.playhead_samples = orig_playhead;
            for (id, muted) in orig_muted {
                if let Some(track) = mixer.tracks.get_mut(&id) {
                    track.is_muted = muted;
                }
            }
        }
        (out_l, out_r)
    }).await.map_err(|e| format!("Task failed: {}", e))?;

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
        scan_plugins,
        open_vst_editor,
        close_vst_editor,
        close_all_vst_editors,
        show_vst_editor,
        send_vst_midi,
        get_vst_audio,
        process_vst_audio,
        add_audio_buffer,
        update_track_regions,
        add_track,
        remove_track,
        set_track_volume,
        set_track_pan,
        set_track_vsts,
        play_midi_note,
        host_play,
        host_pause,
        host_set_playhead,
        load_audio_file,
        load_audio_from_memory,
        read_file_bytes,
        bounce_offline,
        midi::list_midi_outputs,
        midi::open_midi_output,
        midi::close_midi_output,
        midi::send_midi_message
    ])
    .setup(|app| {
        let mixer = std::sync::Arc::new(std::sync::Mutex::new(mixer::Mixer::new()));
        app.manage(mixer.clone());

        match audio_engine::AudioEngineHandle::new(mixer, app.handle().clone()) {
            Ok(handle) => {
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
