use symphonia::core::probe::Hint;
use symphonia::core::io::MediaSourceStream;
use symphonia::core::formats::FormatOptions;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::codecs::{DecoderOptions, CODEC_TYPE_NULL};
use symphonia::core::audio::SampleBuffer;
use std::fs::File;

#[derive(serde::Serialize)]
pub struct AudioFileInfo {
    pub buffer_id: u32,
    pub sample_rate: u32,
    pub channels: u32,
    pub length: usize,
    pub peaks: Vec<f32>,
}

pub fn decode_file<F>(path: &str, buffer_id: u32, target_sample_rate: u32, progress_callback: F) -> Result<(AudioFileInfo, Vec<f32>, Vec<f32>), String> 
where F: FnMut(usize, usize)
{
    let file_size = std::fs::metadata(path).map(|m| m.len() as usize).unwrap_or(0);
    let src = File::open(path).map_err(|e| format!("Failed to open file {}: {}", path, e))?;
    let mss = MediaSourceStream::new(Box::new(src), Default::default());
    decode_mss(mss, buffer_id, target_sample_rate, file_size, progress_callback)
}

pub fn decode_memory<F>(data: Vec<u8>, buffer_id: u32, target_sample_rate: u32, progress_callback: F) -> Result<(AudioFileInfo, Vec<f32>, Vec<f32>), String> 
where F: FnMut(usize, usize)
{
    let file_size = data.len();
    let src = std::io::Cursor::new(data);
    let mss = MediaSourceStream::new(Box::new(src), Default::default());
    decode_mss(mss, buffer_id, target_sample_rate, file_size, progress_callback)
}

fn resample_linear(input: &[f32], in_rate: u32, out_rate: u32) -> Vec<f32> {
    if in_rate == out_rate {
        return input.to_vec();
    }
    
    let ratio = in_rate as f64 / out_rate as f64;
    let out_len = (input.len() as f64 / ratio).ceil() as usize;
    let mut output = Vec::with_capacity(out_len);
    
    for i in 0..out_len {
        let in_pos = i as f64 * ratio;
        let in_idx = in_pos.floor() as usize;
        let frac = (in_pos - in_idx as f64) as f32;
        
        if in_idx + 1 < input.len() {
            let s1 = input[in_idx];
            let s2 = input[in_idx + 1];
            output.push(s1 + (s2 - s1) * frac);
        } else if in_idx < input.len() {
            output.push(input[in_idx]);
        }
    }
    output
}

fn decode_mss<F>(mss: MediaSourceStream, buffer_id: u32, target_sample_rate: u32, file_size: usize, mut progress_callback: F) -> Result<(AudioFileInfo, Vec<f32>, Vec<f32>), String> 
where F: FnMut(usize, usize)
{
    let hint = Hint::new();
    
    let probed = symphonia::default::get_probe()
        .format(&hint, mss, &FormatOptions::default(), &MetadataOptions::default())
        .map_err(|e| format!("Failed to probe format: {}", e))?;
        
    let mut format = probed.format;
    let track = format.tracks().iter().find(|t| t.codec_params.codec != CODEC_TYPE_NULL)
        .ok_or("No supported audio track")?;
        
    let mut decoder = symphonia::default::get_codecs()
        .make(&track.codec_params, &DecoderOptions::default())
        .map_err(|e| format!("Failed to create decoder: {}", e))?;
        
    let sample_rate = track.codec_params.sample_rate.unwrap_or(48000);
    
    // Attempt to preallocate memory if duration is known to prevent reallocation spikes
    let capacity = track.codec_params.n_frames.unwrap_or(0) as usize;
    let mut left = Vec::with_capacity(capacity);
    let mut right = Vec::with_capacity(capacity);
    
    let total_frames = track.codec_params.n_frames.unwrap_or(0);
    let mut decoded_frames = 0;
    
    // Call progress once at start
    if file_size > 0 {
        progress_callback(0, file_size);
    }
    
    loop {
        let packet = match format.next_packet() {
            Ok(packet) => packet,
            Err(symphonia::core::errors::Error::ResetRequired) => {
                decoder.reset();
                continue;
            }
            Err(symphonia::core::errors::Error::IoError(err)) => {
                if err.kind() == std::io::ErrorKind::UnexpectedEof && err.to_string() == "end of stream" {
                    break;
                }
                break;
            }
            Err(_) => {
                break;
            }
        };
        
        match decoder.decode(&packet) {
            Ok(decoded) => {
                decoded_frames += decoded.capacity() as u64;
                if total_frames > 0 && decoded_frames % 22050 < (decoded.capacity() as u64) {
                    let ratio = decoded_frames as f64 / total_frames as f64;
                    let loaded = (ratio * file_size as f64).min(file_size as f64) as usize;
                    progress_callback(loaded, file_size);
                }

                let channels = decoded.spec().channels.count();
                let mut sample_buf = SampleBuffer::<f32>::new(decoded.capacity() as u64, *decoded.spec());
                sample_buf.copy_interleaved_ref(decoded);
                
                let samples = sample_buf.samples();
                
                if channels == 1 {
                    for chunk in samples.chunks(1) {
                        left.push(chunk[0]);
                        right.push(chunk[0]);
                    }
                } else if channels >= 2 {
                    for chunk in samples.chunks(channels) {
                        left.push(chunk[0]);
                        right.push(chunk[1]);
                    }
                }
            }
            Err(_) => {
                break;
            }
        }
    }
    
    // Resample if necessary
    let resampled_left = resample_linear(&left, sample_rate, target_sample_rate);
    let resampled_right = resample_linear(&right, sample_rate, target_sample_rate);
    
    let length = resampled_left.len();
    
    // Limit peaks array to max 8000 elements to keep JSON IPC very fast.
    let target_chunks = 4000; 
    let chunk_size = std::cmp::max(256, length / target_chunks);
    let mut peaks = Vec::new();
    let num_chunks = length / chunk_size;
    
    for i in 0..num_chunks {
        let mut min = 1.0f32;
        let mut max = -1.0f32;
        for j in 0..chunk_size {
            let val = resampled_left[i * chunk_size + j];
            if val < min { min = val; }
            if val > max { max = val; }
        }
        peaks.push(min);
        peaks.push(max);
    }
    
    let info = AudioFileInfo {
        buffer_id,
        sample_rate: target_sample_rate,
        channels: 2,
        length,
        peaks,
    };
    
    Ok((info, resampled_left, resampled_right))
}
