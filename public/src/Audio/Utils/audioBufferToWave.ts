import { audioCtx } from "../../index";
// @ts-ignore
import * as lamejs from "lamejs";

function bufferToWave(abuffer: AudioBuffer) {
    var numOfChan = abuffer.numberOfChannels,
        length = abuffer.length * numOfChan * 2 + 44,
        buffer = new ArrayBuffer(length),
        view = new DataView(buffer),
        channels = [], i, sample,
        offset = 0,
        pos = 0;

    // write WAVE header
    setUint32(0x46464952);                         // "RIFF"
    setUint32(length - 8);                         // file length - 8
    setUint32(0x45564157);                         // "WAVE"

    setUint32(0x20746d66);                         // "fmt " chunk
    setUint32(16);                                 // length = 16
    setUint16(1);                                  // PCM (uncompressed)
    setUint16(numOfChan);
    setUint32(abuffer.sampleRate);
    setUint32(abuffer.sampleRate * 2 * numOfChan); // avg. bytes/sec
    setUint16(numOfChan * 2);                      // block-align
    setUint16(16);                                 // 16-bit (hardcoded in this demo)

    setUint32(0x61746164);                         // "data" - chunk
    setUint32(length - pos - 4);                   // chunk length

    // write interleaved data
    for (i = 0; i < abuffer.numberOfChannels; i++)
        channels.push(abuffer.getChannelData(i));

    while (pos < length) {
        for (i = 0; i < numOfChan; i++) {           // interleave channels
            sample = Math.max(-1, Math.min(1, channels[i][offset])); // clamp
            sample = (0.5 + sample < 0 ? sample * 32768 : sample * 32767)|0; // scale to 16-bit signed int
            view.setInt16(pos, sample, true);        // write 16-bit sample
            pos += 2;
        }
        offset++                                     // next source sample
    }

    // create Blob
    return new Blob([view], { type: "audio/wav" });

    function setUint16(data: number) {
        view.setUint16(pos, data, true);
        pos += 2;
    }

    function setUint32(data: number) {
        view.setUint32(pos, data, true);
        pos += 4;
    }
}

function convertFloat32ToInt16(float32Array: Float32Array): Int16Array {
    const int16Array = new Int16Array(float32Array.length);
    for (let i = 0; i < float32Array.length; i++) {
        let s = Math.max(-1, Math.min(1, float32Array[i]));
        int16Array[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    return int16Array;
}

async function bufferToMp3(abuffer: AudioBuffer, onProgress?: (percent: number) => void): Promise<Blob> {
    const numOfChan = abuffer.numberOfChannels;
    const sampleRate = abuffer.sampleRate;
    const mp3encoder = new lamejs.Mp3Encoder(numOfChan, sampleRate, 192); // 192kbps
    
    const left = convertFloat32ToInt16(abuffer.getChannelData(0));
    const right = numOfChan > 1 ? convertFloat32ToInt16(abuffer.getChannelData(1)) : undefined;
    
    const mp3Data: Int8Array[] = [];
    // Increase chunk size slightly for better performance, but keep small enough for progress updates
    const sampleBlockSize = 1152 * 10; 
    const totalSamples = left.length;
    
    for (let i = 0; i < totalSamples; i += sampleBlockSize) {
        const leftChunk = left.subarray(i, i + sampleBlockSize);
        let mp3buf: Int8Array;
        
        if (numOfChan === 2 && right) {
            const rightChunk = right.subarray(i, i + sampleBlockSize);
            mp3buf = mp3encoder.encodeBuffer(leftChunk, rightChunk);
        } else {
            mp3buf = mp3encoder.encodeBuffer(leftChunk);
        }
        
        if (mp3buf.length > 0) {
            mp3Data.push(mp3buf);
        }

        if (onProgress) {
            onProgress((i / totalSamples) * 100);
            // Yield to UI thread
            await new Promise(resolve => setTimeout(resolve, 0));
        }
    }
    
    const mp3buf = mp3encoder.flush();
    if (mp3buf.length > 0) {
        mp3Data.push(mp3buf);
    }
    
    if (onProgress) onProgress(100);

    return new Blob(mp3Data as any[], { type: 'audio/mp3' });
}

function combineBuffers(buffers: AudioBuffer[]) {
    // Get the max length from all buffers
    let maxLength = Math.max(...buffers.map(buffer => buffer.length));

    // Create a new buffer with the max length
    let outputBuffer = audioCtx.createBuffer(
        buffers[0].numberOfChannels,
        maxLength,
        buffers[0].sampleRate
    );

    // For each buffer, for each channel, copy the data into the outputBuffer
    buffers.forEach(buffer => {
        for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
            let outputData = outputBuffer.getChannelData(channel);
            let inputData = buffer.getChannelData(channel);

            for (let i = 0; i < inputData.length; i++) {
                outputData[i] += inputData[i];
            }
        }
    });
    return outputBuffer;
}

function downloadBlob(blob: Blob, fileName: string) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    link.click();
    link.remove();
}

async function getSaveAudioHandle(defaultFileName: string): Promise<{handle: any, type: 'wav' | 'mp3'} | null> {
    const nameWithoutExt = defaultFileName.replace(/\.(wav|mp3)$/i, '');
    
    if ('showSaveFilePicker' in window) {
        try {
            const handle = await (window as any).showSaveFilePicker({
                suggestedName: nameWithoutExt,
                types: [
                    {
                        description: 'WAV File',
                        accept: { 'audio/wav': ['.wav'] }
                    },
                    {
                        description: 'MP3 File',
                        accept: { 'audio/mp3': ['.mp3'] }
                    }
                ]
            });
            const name = handle.name;
            const type = name.toLowerCase().endsWith('.mp3') ? 'mp3' : 'wav';
            return { handle, type };
        } catch (err: any) {
             // User cancelled or error
             if (err.name !== 'AbortError') {
                console.error("Failed to get file handle:", err);
             }
             return null;
        }
    }
    return null;
}

async function downloadBlobWithPicker(blob: Blob, fileName: string, types: any[]): Promise<void> {
    if ('showSaveFilePicker' in window) {
        try {
            const handle = await (window as any).showSaveFilePicker({
                suggestedName: fileName,
                types: types
            });
            const writable = await handle.createWritable();
            await writable.write(blob);
            await writable.close();
        } catch (err: any) {
            if (err.name !== 'AbortError') {
                console.error("Failed to save file:", err);
            }
        }
    } else {
        downloadBlob(blob, fileName);
    }
}

async function writeAudioToHandle(handle: any, buffer: AudioBuffer, type: 'wav' | 'mp3', onProgress?: (percent: number) => void) {
    let blob: Blob;
    if (type === 'mp3') {
        blob = await bufferToMp3(buffer, onProgress);
    } else {
        blob = bufferToWave(buffer);
        if (onProgress) onProgress(100);
    }
    const writable = await handle.createWritable();
    await writable.write(blob);
    await writable.close();
}

async function exportAudioWithPicker(buffer: AudioBuffer, defaultFileName: string, onProgress?: (percent: number) => void): Promise<void> {
    if ('showSaveFilePicker' in window) {
         const handleObj = await getSaveAudioHandle(defaultFileName);
         if (handleObj) {
             await writeAudioToHandle(handleObj.handle, buffer, handleObj.type, onProgress);
         }
    } else {
         let blob: Blob;
         if (defaultFileName.toLowerCase().endsWith(".mp3")) {
             blob = await bufferToMp3(buffer, onProgress);
         }
         else {
             blob = bufferToWave(buffer);
             if (onProgress) onProgress(100);
         }
         downloadBlob(blob, defaultFileName);
    }
}

export { bufferToWave, combineBuffers, downloadBlob, downloadBlobWithPicker, getSaveAudioHandle, writeAudioToHandle, bufferToMp3, exportAudioWithPicker };
