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

pub fn decode_file(path: &str, buffer_id: u32) -> Result<(AudioFileInfo, Vec<f32>, Vec<f32>), String> {
    let src = File::open(path).map_err(|e| format!("Failed to open file {}: {}", path, e))?;
    let mss = MediaSourceStream::new(Box::new(src), Default::default());
    decode_mss(mss, buffer_id)
}

pub fn decode_memory(data: Vec<u8>, buffer_id: u32) -> Result<(AudioFileInfo, Vec<f32>, Vec<f32>), String> {
    let src = std::io::Cursor::new(data);
    let mss = MediaSourceStream::new(Box::new(src), Default::default());
    decode_mss(mss, buffer_id)
}

fn decode_mss(mss: MediaSourceStream, buffer_id: u32) -> Result<(AudioFileInfo, Vec<f32>, Vec<f32>), String> {
    let mut hint = Hint::new();
    
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
    
    // Limit peaks array to max 8000 elements to keep JSON IPC very fast.
    let target_chunks = 4000; 
    let chunk_size = std::cmp::max(256, left.len() / target_chunks);
    let mut peaks = Vec::new();
    let num_chunks = left.len() / chunk_size;
    
    for i in 0..num_chunks {
        let mut min = 1.0f32;
        let mut max = -1.0f32;
        for j in 0..chunk_size {
            let val = left[i * chunk_size + j];
            if val < min { min = val; }
            if val > max { max = val; }
        }
        peaks.push(min);
        peaks.push(max);
    }
    
    let length = left.len();
    
    let info = AudioFileInfo {
        buffer_id,
        sample_rate,
        channels: 2,
        length,
        peaks,
    };
    
    Ok((info, left, right))
}
