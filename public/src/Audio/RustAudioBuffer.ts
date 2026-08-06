import OperableAudioBuffer from "./OperableAudioBuffer";

/**
 * A hollow audio buffer that does NOT hold the actual Float32Array audio data in JS memory.
 * It only holds downsampled peaks and metadata from the Rust backend.
 */
export default class RustAudioBuffer extends OperableAudioBuffer {
    
    private _length: number;
    private _sampleRate: number;
    private _channels: number;
    private _peaks: Float32Array;
    public nativePath?: string;
    public offset: number = 0;
    
    constructor(bufferId: number, length: number, sampleRate: number, channels: number, peaks: number[] | Float32Array, nativePath?: string, offset: number = 0) {
        super(bufferId);
        // @ts-ignore
        this.bufferId = bufferId; // Overwrite readonly property just in case
        this._length = length;
        this._sampleRate = sampleRate;
        this._channels = channels;
        this._peaks = new Float32Array(peaks);
        this.nativePath = nativePath;
        this.offset = offset;
        this.isSentToRust = true;
    }
    
    get length(): number {
        return this._length;
    }
    
    get sampleRate(): number {
        return this._sampleRate;
    }
    
    get numberOfChannels(): number {
        return this._channels;
    }
    
    /**
     * Get the pre-calculated peaks.
     * The peaks are interleaved [min, max, min, max...] for a chunk of 256 samples.
     */
    get peaks(): Float32Array {
        return this._peaks;
    }

    getChannelData(channel: number): Float32Array {
        console.warn("getChannelData called on RustAudioBuffer! This buffer does not contain full audio data. Returning empty array.");
        return new Float32Array(0);
    }

    toAudioBuffer(audioCtx: AudioContext): AudioBuffer {
        throw new Error("RustAudioBuffer cannot be converted to an AudioBuffer because it does not hold the audio data.");
    }

    override async sendToRust(): Promise<void> {
        // Already loaded directly into Rust!
        this.isSentToRust = true;
    }

    override makeStereo(): OperableAudioBuffer {
        // Rust already treats it as stereo (2 channels)
        return this;
    }

    override clone(): OperableAudioBuffer {
        return new RustAudioBuffer(this.bufferId, this._length, this._sampleRate, this._channels, this._peaks, this.nativePath, this.offset);
    }

    override split(position: number): [OperableAudioBuffer, OperableAudioBuffer] {
        if (position <= 0 || position >= this.length) throw new RangeError("Split point is out of bound");
        
        // Peaks are roughly 256 samples per min/max pair.
        const peakSplitIndex = Math.floor(position / 256) * 2;
        const firstPeaks = this._peaks.slice(0, peakSplitIndex);
        const secondPeaks = this._peaks.slice(peakSplitIndex);

        const first = new RustAudioBuffer(this.bufferId, position, this._sampleRate, this._channels, firstPeaks, this.nativePath, this.offset);
        const second = new RustAudioBuffer(this.bufferId, this.length - position, this._sampleRate, this._channels, secondPeaks, this.nativePath, this.offset + position);
        
        return [first, second];
    }

    override merge(that: AudioBuffer, start_offset: number = 0): OperableAudioBuffer {
        if (that instanceof RustAudioBuffer && that.bufferId === this.bufferId) {
            // Merging slices of the same file. Reconstruct bounds.
            const start = Math.min(this.offset, that.offset - start_offset);
            const end = Math.max(this.offset + this.length, that.offset - start_offset + that.length);
            const newLength = end - start;
            
            let combinedPeaks: Float32Array;
            if (this.offset < that.offset) {
                combinedPeaks = new Float32Array(this._peaks.length + that._peaks.length);
                combinedPeaks.set(this._peaks, 0);
                combinedPeaks.set(that._peaks, this._peaks.length);
            } else {
                combinedPeaks = new Float32Array(this._peaks.length + that._peaks.length);
                combinedPeaks.set(that._peaks, 0);
                combinedPeaks.set(this._peaks, that._peaks.length);
            }

            return new RustAudioBuffer(this.bufferId, newLength, this._sampleRate, this._channels, combinedPeaks, this.nativePath, start);
        } else if (!(that instanceof RustAudioBuffer)) {
            // Extending region with an empty buffer (e.g. from emptyAlike)
            // We treat the 'that' buffer as silence in terms of peaks.
            let beforeLength = start_offset >= 0 ? this.length : that.length;
            let afterLength = start_offset >= 0 ? that.length : this.length;
            const newLength = Math.max(beforeLength, afterLength + Math.abs(start_offset));
            
            const newPeakPairs = Math.ceil(newLength / 256);
            const newPeaks = new Float32Array(newPeakPairs * 2);
            
            if (start_offset >= 0) {
                // this is before, that is after
                newPeaks.set(this._peaks, 0);
                const start = this.offset;
                return new RustAudioBuffer(this.bufferId, newLength, this._sampleRate, this._channels, newPeaks, this.nativePath, start);
            } else {
                // that is before, this is after
                const offsetPairs = Math.floor(Math.abs(start_offset) / 256) * 2;
                newPeaks.set(this._peaks, offsetPairs);
                const start = this.offset - Math.abs(start_offset); // Note: backend might not like negative offset
                return new RustAudioBuffer(this.bufferId, newLength, this._sampleRate, this._channels, newPeaks, this.nativePath, Math.max(0, start));
            }
        } else {
            console.warn("Merging different RustAudioBuffers is not fully supported without memory overhead. Returning silence.");
            return super.merge(that, start_offset);
        }
    }
}
