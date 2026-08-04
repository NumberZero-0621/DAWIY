use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use std::sync::mpsc::{channel, Sender};
use std::sync::{Arc, Mutex};
use std::thread;
use tauri::Emitter;
use crate::mixer::Mixer;

pub enum AudioCommand {
    Stop,
}

pub struct AudioEngineHandle {
    tx: Sender<AudioCommand>,
}

impl AudioEngineHandle {
    pub fn new(mixer: Arc<Mutex<Mixer>>, app_handle: tauri::AppHandle) -> Result<Self, String> {
        let (tx, rx) = channel::<AudioCommand>();
        
        let mixer_for_emitter = mixer.clone();
        thread::Builder::new()
            .name("PlayheadEmitter".to_string())
            .spawn(move || {
                loop {
                    std::thread::sleep(std::time::Duration::from_millis(16)); // ~60fps
                    let (is_playing, playhead_samples, sample_rate, peak_l, peak_r, track_peaks) = {
                        if let Ok(m) = mixer_for_emitter.try_lock() { // オーディオスレッドをブロックしないようtry_lock
                            let mut t_peaks = Vec::new();
                            for (id, track) in &m.tracks {
                                t_peaks.push((*id, track.peak_l, track.peak_r));
                            }
                            (m.is_playing, m.playhead_samples, m.sample_rate, m.peak_l, m.peak_r, t_peaks)
                        } else {
                            continue;
                        }
                    };

                    if is_playing {
                        let playhead_ms = (playhead_samples as f64 / sample_rate as f64) * 1000.0;
                        let _ = app_handle.emit("playhead_update", playhead_ms);
                    }
                    // ピークメーターは常に更新する（残響の減衰なども表示するため）
                    let _ = app_handle.emit("meter_update", (peak_l, peak_r));
                    let _ = app_handle.emit("track_meter_update", track_peaks);
                }
            })
            .map_err(|e| e.to_string())?;

        thread::Builder::new()
            .name("AudioEngineThread".to_string())
            .spawn(move || {
                let host = cpal::default_host();
                let device = match host.default_output_device() {
                    Some(d) => d,
                    None => {
                        log::error!("No output device available");
                        return;
                    }
                };

                let supported_configs_range = match device.supported_output_configs() {
                    Ok(r) => r,
                    Err(e) => {
                        log::error!("Failed to get supported configs: {}", e);
                        return;
                    }
                };
                
                let supported_config = supported_configs_range
                    .filter(|c| c.sample_format() == cpal::SampleFormat::F32)
                    .next()
                    .unwrap_or_else(|| device.supported_output_configs().unwrap().next().unwrap());

                let config = supported_config.with_max_sample_rate().config();
                let channels = config.channels as usize;
                
                let err_fn = |err| log::error!("an error occurred on stream: {}", err);

                let stream = match device.build_output_stream(
                    &config,
                    move |data: &mut [f32], _: &cpal::OutputCallbackInfo| {
                        // ミキサー経由でVSTやトラックの音声を処理
                        if let Ok(mut mixer_lock) = mixer.lock() {
                            mixer_lock.process(data, channels);
                        } else {
                            // ロック取得失敗時は無音出力
                            for frame in data.chunks_mut(channels) {
                                for sample in frame.iter_mut() {
                                    *sample = 0.0;
                                }
                            }
                        }
                    },
                    err_fn,
                    None,
                ) {
                    Ok(s) => s,
                    Err(e) => {
                        log::error!("Failed to build output stream: {}", e);
                        return;
                    }
                };

                if let Err(e) = stream.play() {
                    log::error!("Failed to play stream: {}", e);
                    return;
                }

                log::info!("Audio engine started on device: {}", device.name().unwrap_or_default());
                
                // Stopコマンドを受け取るまでスレッドをブロックし、Streamを生かしておく
                while let Ok(cmd) = rx.recv() {
                    match cmd {
                        AudioCommand::Stop => {
                            log::info!("Stopping audio engine");
                            break;
                        }
                    }
                }
            })
            .map_err(|e| e.to_string())?;

        Ok(AudioEngineHandle { tx })
    }

    pub fn stop(&self) {
        let _ = self.tx.send(AudioCommand::Stop);
    }
}

