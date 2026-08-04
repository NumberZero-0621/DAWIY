import { WamNode } from "@webaudiomodules/api";
import App from "../../App";
import AudioGraph, { AudioGraphInstance } from "../../Audio/Graph/AudioGraph";
import VoidPlayerWAM from "../../Audio/Players/Void/VoidPlayerWAM";
import TrackElement from "../../Components/Editor/TrackElement";
import RegionRecorderManager from "../../Controllers/Recording/Recorders/RegionRecorderManager";
import { observed } from "../../Utils/observable/class_annotation";
import AutomationRegion, { AutomationPoint } from "../Region/AutomationRegion";
import Region, { RegionOf, RegionType } from "../Region/Region";
import RegionPlayer from "../Region/RegionPlayer";
import SoundProvider, { SoundProviderGraphInstance } from "./SoundProvider";

export default class Track extends SoundProvider {


  constructor(element: TrackElement, audioCtx: BaseAudioContext, groupId: string) {
    super(element, groupId, audioCtx)
    this.junctionNode = audioCtx.createGain()
    this.isSolo = false
  }

  override async init(): Promise<void> {
    await super.init()
    this.junctionNode.connect(this.audioInputNode)
    this._playhead_player = await VoidPlayerWAM.createInstance(this.groupId, this.audioContext) as VoidPlayerWAM
    this._playhead_player.audioNode.connect(this.junctionNode)
  }

  override get element() { return super.element as TrackElement }

  /**
   * Adds a region to the regions list.
   * @param region - The region to add.
   */
  public addRegion(region: Region): void {
    region.trackId = this.id
    this.regions.push(region)
  }

  /**
   * Gets the region according to its id.
   * @param regionId - The id of the region.
   * @returns The region if it exists, undefined otherwise.
   */
  public getRegionById(regionId: number): Region | undefined {
    return this.regions.find((region) => region.id === regionId);
  }

  /**
   * Removes a region from the regions list according to its id.
   * @param regionId - The id of the region to remove.
   */
  public removeRegionById(regionId: number): void {
    this.regions = this.regions.filter((region) => region.id !== regionId);
  }

  /**
   * Updates the track cached data when his content has been modified.
   * @param context - The audio context.
   */
  public update(context: AudioContext): void {
    this.updateMergedRegions()
  }

  /* PLAY */
  override setLoop(range: [number, number] | null): void {
    super.setLoop(range)
    this._playhead_player.audioNode.setLoop(range)
    for (const [_, [__, player]] of this.merged_regions) { player.setLoop(range) }
  }

  public override play(): void {
    this._playhead_player.audioNode.isPlaying = true
    for (const [_, [__, player]] of this.merged_regions) { player.isPlaying = true }
  }

  public override pause(): void {
    this._playhead_player.audioNode.isPlaying = false
    for (const [_, [__, player]] of this.merged_regions) { player.isPlaying = false }
  }


  /* CONNECTION */
  public override set playhead(value: number) {
    this._playhead_player.audioNode.playhead = value
    for (const [_, [__, player]] of this.merged_regions) { player.playhead = value }
  }
  public override get playhead(): number {
    return this._playhead_player.audioNode.playhead
  }


  /** The junction node to which all region type output are connected. */
  private junctionNode: GainNode


  /* -~- REGIONS MERGING -~- */
  /** The regions associated to the track. */
  public regions: Region[] = []

  /** The merger regions, for each type of region there is big merger region. */
  public merged_regions = new Map<RegionType<any>, [RegionOf<any>, RegionPlayer]>()

  private _playhead_player: VoidPlayerWAM

  /** Merge all regions into big merged regions. */
  private async updateMergedRegions() {
    // Sort all regions
    const regionMap = new Map<RegionType<any>, RegionOf<any>[]>()
    for (const region of this.regions as RegionOf<any>[]) {
      const list = regionMap.get(region.regionType) ?? []
      regionMap.set(region.regionType, list)
      list.push(region)
    }

    // Collect all player THEN clear and replace them (Probable race condition)
    // TODO Make sure there is no race condition

    // Rustバックエンドに全リージョンとMIDI情報を同期
    if ((window as any).__TAURI__) {
      const { invoke } = await import('@tauri-apps/api/core');
      
      const jsRegions = [];
      const jsMidiEvents: any[] = [];
      
      for (const region of this.regions as RegionOf<any>[]) {
        if (region.regionType === 'SAMPLE') {
          const sampleRegion = region as any;
          // バックグラウンドでアップロードさせる（awaitしない）
          sampleRegion.buffer.sendToRust().catch(console.error);
          
          jsRegions.push({
            buffer_id: sampleRegion.buffer.bufferId,
            start_samples: (sampleRegion.start / 1000) * this.audioContext.sampleRate,
            length_samples: (sampleRegion.duration / 1000) * this.audioContext.sampleRate,
            offset_samples: (sampleRegion.buffer as any).offset || 0
          });
        } else if (region.regionType === 'MIDI') {
          const midiRegion = region as any;
          const regionStartMs = midiRegion.start;
          
          if (midiRegion.midi) {
              midiRegion.midi.forEachNote((note: any, start: number) => {
                  const noteOnTimeMs = regionStartMs + start;
                  const noteOffTimeMs = noteOnTimeMs + note.duration;
                  
                  const noteOnSample = Math.floor((noteOnTimeMs / 1000) * this.audioContext.sampleRate);
                  const noteOffSample = Math.floor((noteOffTimeMs / 1000) * this.audioContext.sampleRate);
                  
                  jsMidiEvents.push({
                      sample_time: noteOnSample,
                      status: 0x90,
                      data1: note.note,
                      data2: Math.floor(note.velocity)
                  });
                  
                  jsMidiEvents.push({
                      sample_time: noteOffSample,
                      status: 0x80,
                      data1: note.note,
                      data2: 0
                  });
              });
          }
        }
      }
      
      jsMidiEvents.sort((a, b) => a.sample_time - b.sample_time);
      try {
          await invoke('update_track_regions', { trackId: this.id, regions: jsRegions, midiEvents: jsMidiEvents.length > 0 ? jsMidiEvents : null });
      } catch (e) {
          console.error("Failed to sync track regions to Rust", e);
      }
    }

    // Merge regions
    const new_merged_regions = new Map<RegionType<any>, [RegionOf<any>, RegionPlayer]>()

    for (const [type, regions] of regionMap) {
      if (type === "SAMPLE") {
        // SAMPLEはRustで再生するため、JS側のプレイヤー作成はスキップ
        continue;
      }

      const merged = Region.mergeAll(regions, true)
      const player = await merged.createPlayer(this.groupId, this.audioContext)
      player.connect(this.junctionNode)
      player.connectEvents(this.audioInputNode)

      // WAM SDKのconnectEventsバグ回避：
      // MIDIPlayerProcessorは再生時にpostMessage({type:'midi_out_trigger'})でメインスレッドに通知する。
      // このメッセージをリッスンし、audioInputNode.scheduleEventsに直接MIDIを転送することで、
      // SoundProviderのフックを経由してVstProxy等にMIDIが届くようにする。
      if ('node' in player && (player as any).node?.port) {
        const midiNode = (player as any).node;
        const origOnMessage = midiNode._onMessage?.bind(midiNode);
        const audioInput = this.audioInputNode;
        midiNode.port.addEventListener('message', (e: MessageEvent) => {
          if (e.data?.type === 'midi_out_trigger') {
            const { channel, note, velocity, duration } = e.data;
            const currentTime = this.audioContext.currentTime;
            // Note On
            audioInput.scheduleEvents({
              type: 'wam-midi',
              time: currentTime,
              data: { bytes: [0x90 | channel, note, velocity] }
            });
            // Note Off (duration ms後)
            setTimeout(() => {
              audioInput.scheduleEvents({
                type: 'wam-midi',
                time: this.audioContext.currentTime,
                data: { bytes: [0x80 | channel, note, 0] }
              });
            }, duration);
          }
        });
      }

      new_merged_regions.set(type, [merged, player])
    }

    // Change playstate
    for (const [_, [__, player]] of new_merged_regions) {
      player.isPlaying = this._playhead_player.audioNode.isPlaying
      player.playhead = this._playhead_player.audioNode.playhead
      player.setLoop(this.loopRange)
    }

    // Clear regions
    const old_merged_regions = this.merged_regions
    this.merged_regions = new_merged_regions
    for (const [type, [region, player]] of old_merged_regions) {
      player.disconnect(this.junctionNode)
      player.disconnectEvents(this.audioInputNode)
      player.dispose()
    }
  }



  /* -~- LIFETIME -~- */
  /** Is the track deleted */
  public deleted = false;

  /** Should be called when the track is deleted and no more used. */
  public override dispose() {
    super.dispose()
    for (const [_, [__, player]] of this.merged_regions) {
      player.disconnect(this.junctionNode)
      player.disconnectEvents(this.audioInputNode)
      player.dispose()
    }
    this.outputNode.disconnect()
    this.recorders.dispose()
    this._playhead_player.audioNode.destroy()
    this.deleted = true

    if ((window as any).__TAURI__) {
      import('@tauri-apps/api/core').then(({ invoke }) => {
        invoke('remove_track', { trackId: this.id }).catch(console.error);
      });
    }
  }

  /** Audio Graph Creation */
  /**
   * Get the sound provider graph of this sound provider.
   */
  get track_graph() {
    const that = this
    return this._track_graph = this._track_graph ?? {

      async instantiate(audioContext: BaseAudioContext, groupId: string) {
        // Create sound provider graph
        const audioProviderInstance = await that.sound_provider_graph.instantiate(audioContext, groupId)

        // Create players graph
        await that.updateMergedRegions()
        const players = await Promise.all([...that.merged_regions.values()].map(region => region[0].createPlayer(groupId, audioContext)))
        for (const player of players) {
          player.connect(audioProviderInstance.inputNode)
          if (audioProviderInstance.plugins.length > 0) player.connectEvents(audioProviderInstance.plugins[0].audioNode)
        }
        return new TrackGraphInstance(audioProviderInstance, players)
      },
    }
  }

  private _track_graph: AudioGraph<TrackGraphInstance> | null = null

  protected override updateMute() {
    if (this.isMuted || this.isSoloMuted) this.muteNode.gain.value = 0
    else this.muteNode.gain.value = 1
  }

  /**
   * Is the track muted by the solo mode of other tracks, if a track is muted it emits no sound
   */
  @observed({
    set(this: Track, value: boolean) {
      this.element.isSoloMuted = value
      this.updateMute()
    },
  })
  public isSoloMuted: boolean = false

  /**
   * Is the track soloed, if at least one track is soloed, only soloed tracks emit sound
   * [WARNING] Don't set isSolo directly, use {@link TracksController#setSolo} instead.
   */
  @observed({
    set(this: Track, value: boolean) {
      if (value) {
        this.isMuted = false
        this.isSoloMuted = false
      }
      this.element.isSolo = value
      this.updateMute()
    },
  })
  public isSolo: boolean = false

  /**
   * The automation regions associated with the track.
   * Multiple regions can be displayed simultaneously.
   */
  public automationRegions: AutomationRegion[] = [];

  /**
   * Stores automation points for each parameter ID.
   */
  public automationData: Map<string, AutomationPoint[]> = new Map();

  /**
   * Is the automation menu opened for this track.
   */
  @observed({
    set(this: Track, value: boolean) {
      this.updateAutomationIcon();
    }
  })
  public isAutomationOpened: boolean = false;

  /**
   * Updates the automation icon state (opened/has-data/none).
   */
  public updateAutomationIcon() {
      this.element.isAutomationOpened = this.isAutomationOpened;
      this.element.hasAutomation = this.checkIfHasAutomationData();
  }

  private checkIfHasAutomationData(): boolean {
      if (!this.automationData || !this.automationRegions) return false;
      // 1. 保管されているデータを確認
      for (const [_, points] of this.automationData) {
          if (this.isPointsAutomated(points)) return true;
      }
      // 2. 現在開いているリージョンのデータを確認
      for (const region of this.automationRegions) {
          if (this.isPointsAutomated(region.points)) return true;
      }
      return false;
  }

    private isPointsAutomated(points: AutomationPoint[]): boolean {
        if (points.length < 2) return false;
        const first = points[0].value;
        for (let i = 1; i < points.length; i++) {
            if (points[i].value !== first) return true;
        }
        return false;
    }

    /**
     * 実際に編集（値の変化）が行われているオートメーションパラメータIDのリストを取得
     */
    public getAutomatedParamIds(): string[] {
        const ids: string[] = [];
        for (const [paramId, points] of this.automationData) {
            if (this.isPointsAutomated(points)) {
                ids.push(paramId);
            }
        }
        return ids;
    }


  /**
   * Stores custom color for each parameter ID.
   */
  public automationColors: Map<string, string> = new Map();

  /**
   * Stores the list of parameter IDs that were visible before closing automation.
   * Used to restore the exact state when reopening.
   */
  public lastAutomationParams: string[] = [];


  /* -~- RECORDING -~- */
  public recorders: RegionRecorderManager<{ app: App, track: Track }>

  /**
   * Is the track monitored.
   * If a track is monitored, it play what is recorder on the track while it is recording.
   */
  public set monitored(value: boolean) {
    if (this.recorders) {
      this.recorders.isMonitoring = value
      this.element.isMonitoring = value
    }
  }

  public get monitored() { return this.recorders.isMonitoring }

}



export class TrackGraphInstance implements AudioGraphInstance {

  constructor(
    public soundProvider: SoundProviderGraphInstance,
    public players: RegionPlayer[]
  ) { }

  connect(destination: AudioNode) { this.soundProvider.connect(destination) }
  disconnect(destination?: AudioNode | undefined) { this.soundProvider.disconnect(destination) }
  connectEvents(destination: WamNode) { this.soundProvider.connectEvents(destination) }
  disconnectEvents(destination?: WamNode | undefined) { this.soundProvider.disconnectEvents(destination) }
  dispose(): void {
    this.soundProvider.dispose()
    for (const player of this.players) player.dispose()
  }

  set playhead(value: number) {
    for (const player of this.players) { player.playhead = value }
  }

  set isPlaying(value: boolean) {
    if (!value) return
    for (const player of this.players) { player.isPlaying = value }
  }

  playEfficiently(start: number, duration: number): Promise<void> {
    return Promise.all(this.players.map(player => player.playEfficiently(start, duration))).then(() => { })
  }



}