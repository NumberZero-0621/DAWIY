import { WamNode, WebAudioModule } from "@webaudiomodules/api";
import OperableAudioBuffer from "../../Audio/OperableAudioBuffer";
import SamplePlayerNode from "../../Audio/Players/Sample/SamplePlayerNode";
import SamplePlayerWAM from "../../Audio/Players/Sample/SamplePlayerWAM";
import { RingBuffer } from "../../Audio/Utils/Ringbuffer";
import { bufferToWave } from "../../Audio/Utils/audioBufferToWave";
import { audioCtx } from "../../index";
import { RegionOf, RegionType } from "./Region";
import RegionPlayer from "./RegionPlayer";


export default class SampleRegion extends RegionOf<SampleRegion> {

    buffer;

    constructor(buffer: OperableAudioBuffer, start: number) {
        super(start);
        this.buffer = buffer;
    }


    _customDuration?: number;

    override get duration(): number { 
        return this._customDuration ?? Math.max(0, this.buffer.duration - this.offset);
    }

    override split(cut: number): [SampleRegion, SampleRegion] {
        const first = this.clone();
        first._customDuration = cut;

        const second = this.clone();
        second.start = this.start + cut;
        second.offset = this.offset + cut;
        second._customDuration = Math.max(0, this.duration - cut);

        return [first, second];
    }

    override clone(): SampleRegion {
        const cloned = new SampleRegion(this.buffer, this.start); // Share the buffer reference for non-destructive edits
        cloned.offset = this.offset;
        cloned._customDuration = this._customDuration;
        return cloned;
    }

    override mergeWith(other: SampleRegion): void {
        // In a non-destructive paradigm, mergeWith for simple trimming isn't typically used.
        // If we really need to merge disparate buffers, we fall back to the old behavior.
        // For extending/trimming, RegionController will just adjust customDuration.
        this.buffer = this.buffer.merge(other.buffer, (other.start - this.start) * audioCtx.sampleRate / 1000)
        if (other.start < this.start) {
            const diff = this.start - other.start;
            this.start = other.start;
            this.offset += diff;
        }
    }

    override emptyAlike(start: number, duration: number): SampleRegion {
        return new SampleRegion(OperableAudioBuffer.create({ sampleRate: audioCtx.sampleRate, length: duration * audioCtx.sampleRate / 1000 }), start)
    }

    override save(): Blob {
        return bufferToWave(this.buffer)
    }

    static TYPE: RegionType<SampleRegion> = "SAMPLE"
    get regionType(): RegionType<SampleRegion> { return SampleRegion.TYPE }

    override async createPlayer(groupid: string, audioContext: AudioContext): Promise<RegionPlayer> {
        const player = await SamplePlayerWAM.createInstance(groupid, audioContext)
        await (player.audioNode as SamplePlayerNode).setAudio(this.buffer.toArray())
        return new SampleRegionPlayer(player, this.buffer)
    }

    silenceSteps(stepMs: number, probability: number) {
        const buffer = this.buffer;
        const sampleRate = buffer.sampleRate;
        const stepSamples = Math.floor(stepMs * sampleRate / 1000);
        const totalSamples = buffer.length;

        for (let pos = 0; pos < totalSamples; pos += stepSamples) {
            const length = Math.min(stepSamples, totalSamples - pos);

            if (Math.random() * 100 < probability) {
                for (let c = 0; c < buffer.numberOfChannels; c++) {
                    const data = buffer.getChannelData(c);
                    for (let i = 0; i < length; i++) {
                        data[pos + i] = 0;
                    }
                }
            }
        }
    }

}

class SampleRegionPlayer implements RegionPlayer {

    constructor(wam: WebAudioModule<WamNode>, buffer: OperableAudioBuffer) {
        const sab = RingBuffer.getStorageForCapacity(audioCtx.sampleRate * 2, Float32Array);
        this.node = wam.audioNode as SamplePlayerNode;
    }

    public node: SamplePlayerNode

    setLoop(range: [number, number] | null): void {
        this.node.setLoop(range)
    }

    connect(node: AudioNode): void {
        this.node.connect(node)
    }

    disconnect(node: AudioNode): void {
        this.node.disconnect(node)
    }

    connectEvents(node: WamNode): void {
        this.node.connectEvents(node.instanceId)
    }

    disconnectEvents(node: WamNode): void {
        this.node.disconnectEvents(node.instanceId)
    }

    set isPlaying(value: boolean) {
        this.node.isPlaying = value
    }

    get isPlaying(): boolean {
        return this.node.isPlaying
    }

    playEfficiently(start: number, duration: number): Promise<void> {
        return this.node.playEfficiently(start, duration)
    }

    set playhead(value: number) {
        this.node.playhead = value
    }

    get playhead(): number {
        return this.node.playhead
    }

    dispose(): void {
        this.node.disconnectEvents()
        this.node.disconnect()
        this.node.destroy()
    }
}