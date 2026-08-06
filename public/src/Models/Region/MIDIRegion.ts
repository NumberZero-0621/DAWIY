import { WamNode, WebAudioModule } from "@webaudiomodules/api";
import { audioCtx } from "../..";
import { MIDI } from "../../Audio/MIDI/MIDI";
import MIDIPlayerNode from "../../Audio/Players/MIDI/MIDIPlayerNode";
import MIDIPlayerWAM from "../../Audio/Players/MIDI/MIDIPlayerWAM";
import { RingBuffer } from "../../Audio/Utils/Ringbuffer";
import { RegionOf, RegionType } from "./Region";
import RegionPlayer from "./RegionPlayer";

export default class MIDIRegion extends RegionOf<MIDIRegion>{

    midi: MIDI;

    constructor(midi: MIDI, start: number) {
        super(start);
        this.midi = midi;
    }
    
    _customDuration?: number;

    override get duration(): number { 
        return this._customDuration ?? Math.max(0, this.midi.duration - this.offset);
    }

    override split(cut:number): [MIDIRegion, MIDIRegion] {
        const first = this.clone();
        first._customDuration = cut;

        const second = this.clone();
        second.start = this.start + cut;
        second.offset = this.offset + cut;
        second._customDuration = Math.max(0, this.duration - cut);

        return [first, second];
    }

    override clone(): MIDIRegion {
        const cloned = new MIDIRegion(this.midi, this.start); // Share the midi reference for non-destructive edits
        cloned.offset = this.offset;
        cloned._customDuration = this._customDuration;
        return cloned;
    }

    override mergeWith(other: MIDIRegion): void {
        // In a non-destructive paradigm, mergeWith for simple trimming isn't typically used.
        const offset = other.start - this.start
        if(offset > 0) {
            this.midi = this.midi.merge(other.midi, offset)
        } else {
            this.start = other.start
            this.midi = other.midi.merge(this.midi, -offset)
            this.offset = 0;
        }
    }

    override save(): Blob {
        return this.midi.save()
    }

    override emptyAlike(start: number, duration: number): MIDIRegion {
        return new MIDIRegion(MIDI.empty(this.midi.instant_duration, duration), start)
    }
    
    static TYPE: RegionType<MIDIRegion>="MIDI"
    get regionType(): RegionType<MIDIRegion> { return MIDIRegion.TYPE } 

    override async createPlayer(groupid: string, audioContext: AudioContext): Promise<RegionPlayer> {
        const player=await MIDIPlayerWAM.createInstance(groupid,audioContext)
        await (player.audioNode as MIDIPlayerNode).setMidi(this.midi)
        return new MIDIRegionPlayer(player, this.midi)
    }

}


class MIDIRegionPlayer implements RegionPlayer{

    constructor(wam:WebAudioModule<WamNode>, midi: MIDI){
        const sab = RingBuffer.getStorageForCapacity(audioCtx.sampleRate * 2,Float32Array);
        this.wam=wam
        this.node = wam.audioNode as MIDIPlayerNode;
    }

    public node
    public wam

    setLoop(range: [number,number]|null): void{
        console.log("Setting loop",range)
        this.node.setLoop(range)
    }

    connect(node: WamNode): void {
        this.node.connect(node)
    }

    disconnect(node: WamNode): void {
        this.node.disconnect(node)
    }

    connectEvents(node: WamNode): void {
        this.node.connectEvents(node.instanceId)
    }

    disconnectEvents(node: WamNode): void {
        this.node.disconnectEvents(node.instanceId)
    }

    set isPlaying(value: boolean){
        this.node.isPlaying=value
    }
    
    get isPlaying(): boolean{
        return this.node.isPlaying
    }

    playEfficiently(start: number, duration: number): Promise<void>{
        return this.node.playEfficiently(start, duration)
    }

    set playhead(value: number) {
        this.node.playhead=value
    }

    get playhead(): number {
        return this.node.playhead
    }

    dispose(): void {
        this.node.disconnect()
        this.node.disconnectEvents()
        this.node.destroy()
    }
}