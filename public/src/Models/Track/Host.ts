import { WamNode } from "@webaudiomodules/sdk";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { audioCtx } from "../..";
import App from "../../App";
import { TEMPO } from "../../Env";
import AudioGraph, { AudioGraphInstance } from "../../Audio/Graph/AudioGraph";
import ObservePlayerNode from "../../Audio/Players/Observer/ObservePlayerNode";
import ObservePlayerWAM from "../../Audio/Players/Observer/ObservePlayerWAM";
import SoundProviderElement from "../../Components/Editor/SoundProviderElement";
import { ReadOnlyObservableArray } from "../../Utils/observable/observables";
import SoundProvider, { SoundProviderGraphInstance } from "./SoundProvider";
import Track, { TrackGraphInstance } from "./Track";
import AutomationRegion, { AutomationPoint } from "../Region/AutomationRegion";
import TempoMap from "../../Utils/TempoMap";
/**
 * Host class that work as the master sound provider.
 * Its output is the combined output of all the tracks.
 */
export default class Host extends SoundProvider {

    /**
     * Id of the host group.
     */
    public hostGroupId: string

    /**
     * Latency of the host in milliseconds.
     */
    public latency: number

    /**
     * Host node.
     */
    private hostNode: ObservePlayerNode


    /**
     * Boolean that indicates if the host is recording.
     */
    public recording: boolean

    /**
     * BPM automation state
     */
    public bpmAutomationOpened: boolean = false;
    public bpmAutomationRegion: AutomationRegion | null = null;
    public bpmAutomationData: AutomationPoint[] = [];
    public bpmMinDisplay: number = 60;
    public bpmMaxDisplay: number = 200;

    /**
     * Updates the BPM display range and re-normalizes existing automation points to keep their absolute BPM values.
     */
    public updateBpmDisplayRange(newMin?: number, newMax?: number) {
        const oldMin = this.bpmMinDisplay;
        const oldMax = this.bpmMaxDisplay;
        
        if (newMin !== undefined) this.bpmMinDisplay = Math.max(5, Math.min(this.bpmMaxDisplay - 10, newMin));
        if (newMax !== undefined) this.bpmMaxDisplay = Math.min(600, Math.max(this.bpmMinDisplay + 10, newMax));
        
        if (this.bpmMinDisplay === oldMin && this.bpmMaxDisplay === oldMax) return;

        // Re-normalize all points in the BPM region to maintain their absolute BPM values
        if (this.bpmAutomationRegion) {
            this.bpmAutomationRegion.points.forEach((p: any) => {
                const absoluteBpm = oldMin + p.value * (oldMax - oldMin);
                p.value = (absoluteBpm - this.bpmMinDisplay) / (this.bpmMaxDisplay - this.bpmMinDisplay);
                p.value = Math.max(0, Math.min(1, p.value));
            });
        }
    }

    public getTempoMap(pixelsPerBeat: number = 29.67): TempoMap {
        const points = this.bpmAutomationRegion ? this.bpmAutomationRegion.points : [];
        const denormalize = (v: number) => this.bpmMinDisplay + v * (this.bpmMaxDisplay - this.bpmMinDisplay);
        return new TempoMap(points, TEMPO, pixelsPerBeat, denormalize);
    }

    metronome: any;
    metronomeOn: any;
    MetronomeElement: any;

    private tracks: ReadOnlyObservableArray<Track>

    /**
     * Create a new host track, a compisite track composed of multiple tracks.
     * @param app The app
     * @param tracks Its children tracks
     */
    constructor(app: App, audioContext: BaseAudioContext, tracks: ReadOnlyObservableArray<Track>) {
        super(new SoundProviderElement(), "NO_GROUP_ID", audioContext);
        this.tracks = tracks
        this.tracks_listener_remove = this.onTrackRemove.bind(this)
        this.tracks_listener_add = this.onTrackAdd.bind(this)
        this.tracks.addListener("remove", this.tracks_listener_remove)
        this.tracks.addListener("add", this.tracks_listener_add)
        this.tracks.forEach(it => this.onTrackAdd(it))

        this.latency = 0;
        this.hostGroupId = "";

        this.recording = false;

        this.volume = 1;
    }

    /**
     * Initialize the host node. It is used to control the global volume and the playhead.
     * It is asynchronous because it needs to load the WAM SDK and the AudioPlayerNode.
     */
    override async init() {
        console.log("startinit")
        const { default: initializeWamHost } = await import("@webaudiomodules/sdk/src/initializeWamHost");
        await audioCtx.audioWorklet.addModule(new URL('../../Audio/HostProcessor.js', import.meta.url));

        const [hostGroupId] = await initializeWamHost(audioCtx);
        this.hostGroupId = hostGroupId;
        // @ts-ignore
        this.groupId = hostGroupId

        await super.init()

        this.hostNode = (await ObservePlayerWAM.createInstance(hostGroupId, audioCtx)).audioNode as ObservePlayerNode
        console.log("after")
        this.hostNode.on_update.add(playhead => {
            // this.onPlayHeadMove.forEach(it => it(playhead, true))
            // this._playhead = playhead
        })
        
        listen<number>('playhead_update', (event) => {
            const playheadMs = event.payload;
            this.onPlayHeadMove.forEach(it => it(playheadMs, true));
            this._playhead = playheadMs;
        });
        this.hostNode.connect(this.audioInputNode)
        this.outputNode.connect(audioCtx.destination)

        this.playhead = 0;
        console.log("stopinit")
    }

    public override update(context: AudioContext): void {
        for (const track of this.tracks) {
            if (track.modified && !this.forbidUpdate.has(track)) {
                track.update(context)
                track.modified = false
            }
        }
    }

    /* PLAYHEAD */
    /** Called when the playhead is moved, with the new position in milliseconds */
    public onPlayHeadMove = new Set<(position: number, movedByPlayer: boolean) => void>()

    private _playhead: number

    public override get playhead() { return this._playhead }
    public override set playhead(value: number) {
        this._playhead = value
        this.hostNode.playhead = value
        this.onPlayHeadMove.forEach(it => it(value, false))
        for (const track of this.tracks) track.playhead = value
        invoke('host_set_playhead', { playheadMs: value }).catch(console.error)
    }


    /* PLAY AND PAUSE */
    private _playing: boolean = false

    /** Tracks that should not be updated. */
    readonly forbidUpdate: Set<Track> = new Set()


    public get isPlaying() {
        return this._playing
    }

    public override play(): void {
        // Update loop time
        this.setLoop(this.loopRange)

        // Play
        for (const track of this.tracks) track.play()
        this.hostNode.isPlaying = true
        this._playing = true
        invoke('host_play').catch(console.error)

        // Check for updates while playing
        const host = this
        setTimeout(function updateTrack() {
            if (host.modified) host.update(audioCtx)
            if (host._playing) setTimeout(updateTrack, 300)
        }, 300)
    }

    public override pause(): void {
        for (const track of this.tracks) track.pause()
        this.hostNode.isPlaying = false
        this._playing = false
        invoke('host_pause').catch(console.error)
    }


    /** ON CHANGE */
    private tracks_listener_remove: (removed: Track) => void
    private tracks_listener_add: (added: Track) => void

    private onTrackAdd(track: Track) {
        track.outputNode.connect(this.audioInputNode)
        track.setLoop(this.loopRange)
        track.playhead = this.playhead
        if (this._playing) track.play()
        else track.pause()
    }

    private onTrackRemove(track: Track) {
        track.outputNode.disconnect(this.audioInputNode)
    }


    /** LOOP */
    override setLoop(range: [number, number] | null): void {
        super.setLoop(range)
        this.hostNode.setLoop(range)
        for (const track of this.tracks) track.setLoop(this.loopRange)
    }

    protected override _isModified(decorated: boolean): boolean {
        if (decorated) return true
        for (const track of this.tracks) {
            if (track.modified) return true
        }
        return false
    }

    onDestroy() {
        for (const track of this.tracks) this.onTrackRemove(track)
        this.tracks.removeListener("remove", this.tracks_listener_remove)
        this.tracks.removeListener("add", this.tracks_listener_add)
    }

    /** Audio Graph Creation */
    /**
     * Get the sound provider graph of this sound provider.
     */
    get host_graph() {
        const that = this
        return this._host_graph = this._host_graph ?? {
            async instantiate(audioContext: BaseAudioContext, groupId: string) {
                // Create sound provider graph
                const audioProviderInstance = await that.sound_provider_graph.instantiate(audioContext, groupId)

                // Create players graph
                const tracks = await Promise.all([...that.tracks].map(it => it.track_graph.instantiate(audioContext, groupId)))
                for (const track of tracks) {
                    track.connect(audioProviderInstance.inputNode)
                    if (audioProviderInstance.plugins.length > 0) track.connectEvents(audioProviderInstance.plugins[0].audioNode)
                }
                return new HostGraphInstance(audioProviderInstance, tracks)
            }
        }
    }

    private _host_graph: AudioGraph<HostGraphInstance> | null = null
}


export class HostGraphInstance implements AudioGraphInstance {

    constructor(
        public soundProvider: SoundProviderGraphInstance,
        public tracks: TrackGraphInstance[]
    ) { }

    connect(destination: AudioNode): void { this.soundProvider.connect(destination) }
    connectEvents(destination: WamNode): void { this.soundProvider.connectEvents(destination) }
    disconnect(destination?: AudioNode | undefined): void { this.soundProvider.disconnect(destination) }
    disconnectEvents(destination?: WamNode | undefined): void { this.soundProvider.disconnectEvents(destination) }

    dispose(): void {
        this.soundProvider.dispose()
        for (const track of this.tracks) track.dispose()
    }

    set playhead(value: number) {
        for (const track of this.tracks) track.playhead = value
    }

    public play(): void {
        for (const track of this.tracks) track.isPlaying = true
    }

    public playEfficiently(start: number, duration: number): Promise<void> {
        return Promise.all(this.tracks.map(player => player.playEfficiently(start, duration))).then(() => { })
    }

}
