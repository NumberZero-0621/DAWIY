use std::collections::HashMap;
use crate::vst_host;

#[derive(Clone, Debug)]
pub struct Region {
    pub buffer_id: u32,
    pub start_samples: u64,
    pub length_samples: u64,
    pub offset_samples: u64,
}

pub struct Track {
    pub id: u32,
    pub vst_instances: Vec<u32>,
    pub volume: f32,
    pub pan: f32,
    pub is_muted: bool,
    pub regions: Vec<Region>,
    pub pending_midi: Vec<(u8, u8, u8)>,
    pub midi_sequence: Vec<(u64, u8, u8, u8)>,
    pub peak_l: f32,
    pub peak_r: f32,
}

pub struct Mixer {
    pub tracks: HashMap<u32, Track>,
    pub is_playing: bool,
    pub is_offline_render: bool,
    pub playhead_samples: u64,
    pub sample_rate: u32,
    pub peak_l: f32,
    pub peak_r: f32,
    pub audio_buffers: HashMap<u32, (Vec<f32>, Vec<f32>)>,
}

impl Mixer {
    pub fn new() -> Self {
        Mixer {
            tracks: HashMap::new(),
            audio_buffers: HashMap::new(),
            is_playing: false,
            is_offline_render: false,
            playhead_samples: 0,
            sample_rate: 48000,
            peak_l: 0.0,
            peak_r: 0.0,
        }
    }

    fn ensure_track(&mut self, track_id: u32) -> &mut Track {
        self.tracks.entry(track_id).or_insert(Track {
            id: track_id,
            volume: 1.0,
            pan: 0.0,
            is_muted: false,
            pending_midi: Vec::new(),
            midi_sequence: Vec::new(),
            vst_instances: Vec::new(),
            peak_l: 0.0,
            peak_r: 0.0,
            regions: Vec::new(),
        })
    }

    pub fn remove_track(&mut self, track_id: u32) {
        self.tracks.remove(&track_id);
    }

    pub fn set_track_volume(&mut self, track_id: u32, volume: f32) {
        self.ensure_track(track_id).volume = volume;
    }

    pub fn set_track_pan(&mut self, track_id: u32, pan: f32) {
        self.ensure_track(track_id).pan = pan;
    }

    pub fn set_track_mute(&mut self, track_id: u32, is_muted: bool) {
        self.ensure_track(track_id).is_muted = is_muted;
    }

    pub fn add_midi_event(&mut self, track_id: u32, status: u8, data1: u8, data2: u8) {
        self.ensure_track(track_id).pending_midi.push((status, data1, data2));
    }

    pub fn set_track_vsts(&mut self, track_id: u32, vst_ids: Vec<u32>) {
        self.ensure_track(track_id).vst_instances = vst_ids;
    }

    pub fn add_audio_buffer(&mut self, buffer_id: u32, left: Vec<f32>, right: Vec<f32>) {
        self.audio_buffers.insert(buffer_id, (left, right));
    }

    pub fn update_track_regions(&mut self, track_id: u32, regions: Vec<Region>) {
        self.ensure_track(track_id).regions = regions;
    }

    pub fn process(&mut self, output: &mut [f32], channels: usize) {
        let num_samples = output.len() / channels;
        for i in 0..output.len() {
            output[i] = 0.0;
        }

        let prev_playhead = self.playhead_samples;
        if self.is_playing {
            self.playhead_samples += num_samples as u64;
        }

        // 各トラックの処理
        for track in self.tracks.values_mut() {
            if track.is_muted {
                track.pending_midi.clear();
                track.peak_l = 0.0;
                track.peak_r = 0.0;
                continue;
            }
            
            if self.is_offline_render {
                let playhead_start = prev_playhead; 
                let playhead_end = self.playhead_samples;
                for &(time, status, d1, d2) in &track.midi_sequence {
                    if time >= playhead_start && time < playhead_end {
                        track.pending_midi.push((status, d1, d2));
                    }
                }
            }

            let mut current_l = vec![0.0; num_samples];
            let mut current_r = vec![0.0; num_samples];
            
            // Regionから音声を読み込んでバッファに足す
            for region in &track.regions {
                // リージョンが現在の再生範囲に被っているかチェック
                let region_end = region.start_samples + region.length_samples;
                if self.is_playing {
                    let playhead_start = prev_playhead;
                    let playhead_end = self.playhead_samples;
                    
                    if region.start_samples < playhead_end && region_end > playhead_start {
                        // 被っている部分を計算
                        let read_start_in_region = if playhead_start > region.start_samples {
                            playhead_start - region.start_samples
                        } else {
                            0
                        };
                        
                        let write_start_in_buffer = if region.start_samples > playhead_start {
                            (region.start_samples - playhead_start) as usize
                        } else {
                            0
                        };
                        
                        let copy_length = std::cmp::min(
                            (region_end - (region.start_samples + read_start_in_region)) as usize,
                            num_samples - write_start_in_buffer
                        );
                        
                        // バッファから読み込み
                        if let Some((buf_l, buf_r)) = self.audio_buffers.get(&region.buffer_id) {
                            let buf_offset = (region.offset_samples + read_start_in_region) as usize;
                            for i in 0..copy_length {
                                if buf_offset + i < buf_l.len() {
                                    current_l[write_start_in_buffer + i] += buf_l[buf_offset + i];
                                }
                                if buf_offset + i < buf_r.len() {
                                    current_r[write_start_in_buffer + i] += buf_r[buf_offset + i];
                                }
                            }
                        }
                    }
                }
            }

            // VSTチェーンの処理
            for (idx, vst_id) in track.vst_instances.iter().enumerate() {
                // 最初のVST（通常インストゥルメント）にMIDIを送信
                if idx == 0 {
                    for (status, data1, data2) in &track.pending_midi {
                        let _ = vst_host::send_midi(*vst_id, *status, *data1, *data2);
                    }
                }
                if let Ok((out_l, out_r)) = vst_host::process_audio(*vst_id, num_samples, current_l.clone(), current_r.clone(), self.is_playing, self.is_offline_render, self.playhead_samples) {
                    current_l = out_l;
                    current_r = out_r;
                }
            }
            track.pending_midi.clear();

            // トラック出力のピークレベル計算とマスター出力への加算
            let out_len = std::cmp::min(num_samples, current_l.len());
            let mut cur_track_peak_l = 0.0f32;
            let mut cur_track_peak_r = 0.0f32;

            let angle = (track.pan + 1.0) * std::f32::consts::PI / 4.0;
            let gain_l = angle.cos();
            let gain_r = angle.sin();

            for i in 0..out_len {
                let out_idx = i * channels;
                let sample_l = current_l[i] * track.volume * gain_l;
                let sample_r = current_r[i] * track.volume * gain_r;

                if channels >= 2 {
                    output[out_idx] += sample_l;
                    output[out_idx + 1] += sample_r;
                    if sample_l.abs() > cur_track_peak_l { cur_track_peak_l = sample_l.abs(); }
                    if sample_r.abs() > cur_track_peak_r { cur_track_peak_r = sample_r.abs(); }
                } else if channels >= 1 {
                    output[out_idx] += sample_l;
                    if sample_l.abs() > cur_track_peak_l { cur_track_peak_l = sample_l.abs(); }
                    cur_track_peak_r = cur_track_peak_l;
                }
            }
            
            if cur_track_peak_l > track.peak_l {
                track.peak_l = track.peak_l * 0.4 + cur_track_peak_l * 0.6;
            } else {
                track.peak_l *= 0.96;
            }
            if cur_track_peak_r > track.peak_r {
                track.peak_r = track.peak_r * 0.4 + cur_track_peak_r * 0.6;
            } else {
                track.peak_r *= 0.96;
            }
        }

        // マスターピークレベルの計算
        let mut cur_peak_l = 0.0f32;
        let mut cur_peak_r = 0.0f32;

        for i in 0..num_samples {
            let out_idx = i * channels;
            if channels >= 2 {
                let l = output[out_idx].abs();
                let r = output[out_idx + 1].abs();
                if l > cur_peak_l { cur_peak_l = l; }
                if r > cur_peak_r { cur_peak_r = r; }
            } else if channels >= 1 {
                let m = output[out_idx].abs();
                if m > cur_peak_l { cur_peak_l = m; }
                cur_peak_r = cur_peak_l;
            }
        }

        if cur_peak_l > self.peak_l {
            // Smooth attack (e.g., 60% new peak, 40% old peak)
            self.peak_l = self.peak_l * 0.4 + cur_peak_l * 0.6;
        } else {
            // Smooth release (slower decay)
            self.peak_l *= 0.96;
        }

        if cur_peak_r > self.peak_r {
            self.peak_r = self.peak_r * 0.4 + cur_peak_r * 0.6;
        } else {
            self.peak_r *= 0.96;
        }
    }
}
