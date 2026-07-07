use std::collections::HashMap;
use crate::vst_host;

pub struct Track {
    pub id: u32,
    pub volume: f32,
    pub vst_instance_id: Option<u32>,
    pub pending_midi: Vec<(u8, u8, u8)>,
}

pub struct Mixer {
    pub tracks: HashMap<u32, Track>,
}

impl Mixer {
    pub fn new() -> Self {
        Mixer {
            tracks: HashMap::new(),
        }
    }

    pub fn add_track(&mut self, track_id: u32) {
        self.tracks.insert(track_id, Track {
            id: track_id,
            volume: 1.0,
            vst_instance_id: None,
            pending_midi: Vec::new(),
        });
    }

    pub fn set_track_vst(&mut self, track_id: u32, vst_id: u32) {
        if let Some(track) = self.tracks.get_mut(&track_id) {
            track.vst_instance_id = Some(vst_id);
        }
    }

    pub fn send_midi(&mut self, track_id: u32, status: u8, data1: u8, data2: u8) {
        if let Some(track) = self.tracks.get_mut(&track_id) {
            track.pending_midi.push((status, data1, data2));
        }
    }

    pub fn process(&mut self, output: &mut [f32], channels: usize) {
        let num_samples = output.len() / channels;
        
        // 出力バッファをゼロクリア
        for sample in output.iter_mut() {
            *sample = 0.0;
        }

        // 各トラックの処理
        for track in self.tracks.values_mut() {
            if let Some(vst_id) = track.vst_instance_id {
                
                // 1. MIDIイベントの送信
                for (status, data1, data2) in track.pending_midi.drain(..) {
                    let _ = vst_host::send_midi(vst_id, status, data1, data2);
                }

                // 2. 音声の処理 (※現状はvst_host側のチャネル通信仕様を利用しているため、将来的にロックフリー化が必要)
                // 空の入力バッファを作成
                let in_l = vec![0.0; num_samples];
                let in_r = vec![0.0; num_samples];
                
                if let Ok((out_l, out_r)) = vst_host::process_audio(vst_id, num_samples, in_l, in_r) {
                    // 3. ミックスダウン (出力バッファへの加算)
                    let out_len = std::cmp::min(num_samples, out_l.len());
                    for i in 0..out_len {
                        let out_idx = i * channels;
                        if channels >= 2 && i < out_r.len() {
                            output[out_idx] += out_l[i] * track.volume;     // L
                            output[out_idx + 1] += out_r[i] * track.volume; // R
                        } else if channels >= 1 {
                            output[out_idx] += out_l[i] * track.volume;     // Mono
                        }
                    }
                }
            }
        }
    }
}
