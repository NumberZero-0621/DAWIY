import { WamNode, WebAudioModule } from "@webaudiomodules/api";
import { crashOnDebug } from "../../App";
import AudioGraph from "../../Audio/Graph/AudioGraph";
import PassthroughWAM from "../../Audio/Node/PassthroughWAM";
import SoundProviderElement from "../../Components/Editor/SoundProviderElement";
import Automation from "../Automation";
import Plugin, { PluginInstance } from "../Plugin";

/**
 * A sound output, controlled by a playhead, and with a volume and a balance.
 * You can also attach a plugin to it.
 * Tracks are sound providers.
 * The host is a sound provider.
 * 
 * The internal audio graph of a sound provider is the following:
 * Without any plugin attached: audioInputNode -> pannerNode -> gainNode -> outputNode
 * With a plugin attached: audioInputNode -> pluginNode[0] -> ... -> pluginNode[N] -> pannerNode -> gainNode -> outputNode
 */
export default abstract class SoundProvider {

  /* -~- OUTPUT NODES -~- */
  /** The gain node associated to the track. It is used to control the volume of the track and is the outputNode of the track. **/
  protected gainNode: GainNode

  /** The panner node associated to the track. It is used to control the balance of the track. **/
  private pannerNode: StereoPannerNode

  /** The WAM input : The input of the sound provider */
  private inputWAM: WebAudioModule

  /* -~- TRACK PROPERTIES -~- */
  /** The unique id of the track. */
  public id: number

  /** The track element associated to the track. */
  private _element: SoundProviderElement
  public get element() { return this._element }

  /** The automation associated to the track. */
  public automation: Automation

  private _modified: boolean

  constructor(element: SoundProviderElement, readonly groupId: string, readonly audioContext: BaseAudioContext) {
    // Audio Nodes
    this.gainNode = audioContext.createGain();
    this.gainNode.gain.value = 0.5;
    this.pannerNode = audioContext.createStereoPanner();
    this.pannerNode.connect(this.gainNode)

    // Track properties
    this._element = element;
    this.color = "";
    this.automation = new Automation();

    // Default Controls
    this.volume = 0.5;

    // Recording controls.
    this.isMuted = false

    this.modified = true
  }

  /**
   * Callback called when the plugin parameters list changes.
   */
  public onPluginParamChange?: (track: SoundProvider) => void;


  /** LIFTIME */
  /** 
   * Should be called at the sound provider creation.
   * Initialize the input node of the sound provider.
   **/
  async init() {
    this.inputWAM = await PassthroughWAM.createInstance(this.groupId, this.audioContext)
    this.audioInputNode.connect(this.pannerNode)
  }

  /** Should be called at the sound provider destruction to clean up */
  dispose() {
    this.removeAllPlugins()
    this.audioInputNode.destroy()
  }



  /** VOLUME, MUTE and SOLO */
  /** The volume of the track. */
  private _volume: number

  protected updateVolume() {
    if (!this.isMuted) this.gainNode.gain.value = this._volume
    else this.gainNode.gain.value = 0
  }


  /**
   * The volume of the track
   */
  public set volume(value: number) {
    // Set volume
    this._volume = value
    if (this.element.volumeSlider) this.element.volumeSlider.value = "" + value * 100;

    this.updateVolume()
  }

  public get volume() { return this._volume }



  /**
   * Is the track muted, if a track is muted it emits no sound
   */
  public set isMuted(value: boolean) {
    this._muted = value
    this.element.isMuted = value
    this.updateVolume()
  }

  public get isMuted() { return this._muted }

  private _muted: boolean = false


  /** The color of the track in HEX format (#FF00FF). It is used to display the waveform. */
  private _color: string

  public set color(newColor: string) {
    this._color = newColor
    this.element.color = newColor
  }

  public get color() { return this._color }


  /**
   * The balance of the track. The panning of the track.
   */
  public set balance(value: number) {
    this.pannerNode.pan.value = value
    this.element.balanceSlider.value = "" + value
  }

  public get balance() { return this.pannerNode.pan.value }

  /**
   * Updates the track cached data when his content has been modified.
   * @param context - The audio context.
   * @param playhead - The playhead position in buffer samples.
   */
  public abstract update(context: AudioContext, playhead: number): void



  /* ~ CONNECTIONS ~ */
  /**
   * The input node of the effect graph, any sound or event send into it will be treated
   * by the plugin and the settings.
   */
  get audioInputNode() {
    if (!this.inputWAM.initialized) crashOnDebug(`This sound provider${this.constructor.name} has not been initialized`)
    return this.inputWAM.audioNode
  }

  /**
   * The output node of the sound provider.
   */
  public get outputNode(): AudioNode { return this.gainNode }




  /** ~ PLUGINS ~ **/
  private _plugins: PluginInstance[] = [] // The plugins associated to the track in order.

  get plugins(): PluginInstance[] { return this._plugins }

  /**
   * (Deprecated: Use plugins instead) Returns the first plugin for backward compatibility in some modules.
   */
  get plugin(): PluginInstance | null { return this._plugins.length > 0 ? this._plugins[0] : null }

  public isGlobalPluginBypass: boolean = false;

  public setGlobalPluginBypass(bypassed: boolean) {
    if (this.isGlobalPluginBypass !== bypassed) {
      this.isGlobalPluginBypass = bypassed;
      this.updatePluginRouting();
    }
  }

  /**
   * Update the audio routing based on the current plugins array.
   */
  public updatePluginRouting() {
    // First, disconnect everything from the input and between plugins
    this.audioInputNode.disconnect()
    this.audioInputNode.disconnectEvents()

    for (const p of this._plugins) {
      p.audioNode.disconnect()
      p.audioNode.disconnectEvents()
    }

    // audioInputNodeのscheduleEventsフックをリセット
    if ((this.audioInputNode as any)._origScheduleEvents) {
      (this.audioInputNode as any).scheduleEvents = (this.audioInputNode as any)._origScheduleEvents;
      delete (this.audioInputNode as any)._origScheduleEvents;
    }
    // audioInputNodeのMIDIイベントリスナーをリセット
    if ((this.audioInputNode as any)._midiEventListener) {
      this.audioInputNode.removeEventListener('wam-midi', (this.audioInputNode as any)._midiEventListener);
      delete (this.audioInputNode as any)._midiEventListener;
    }

    const activePlugins = this.isGlobalPluginBypass ? [] : this._plugins.filter(p => !p.isBypassed);

    // If no active plugins
    if (activePlugins.length === 0) {
      this.audioInputNode.connect(this.pannerNode)
      this.element.hasPlugin = this._plugins.length > 0;
      return
    }

    // Connect input to the first active plugin
    this.audioInputNode.connect(activePlugins[0].audioNode)
    this.audioInputNode.connectEvents(activePlugins[0].audioNode.instanceId)

    // Connect active plugins in series
    for (let i = 0; i < activePlugins.length - 1; i++) {
      activePlugins[i].audioNode.connect(activePlugins[i + 1].audioNode)
      activePlugins[i].audioNode.connectEvents(activePlugins[i + 1].audioNode.instanceId)
    }

    // Connect the last active plugin to the panner
    const lastPlugin = activePlugins[activePlugins.length - 1]
    lastPlugin.audioNode.connect(this.pannerNode)

    // --- MIDI転送フック ---
    // WAMの connectEvents はAudioWorklet間のイベント転送に依存しているが、
    // ParamMgrProcessor等では正しくMIDIが転送されない場合があるため、
    // メインスレッド側で直接MIDIを転送する。
    const firstPluginNode = activePlugins[0].audioNode;
    const inputNode = this.audioInputNode;

    // フック1: メインスレッドからの直接scheduleEvents呼び出し用（ピアノロールのプレビュー等）
    const origScheduleEvents = inputNode.scheduleEvents.bind(inputNode);
    (inputNode as any)._origScheduleEvents = origScheduleEvents;

    (inputNode as any).scheduleEvents = (...events: any[]) => {
      const midiEvents = events.filter((e: any) => e.type === 'wam-midi');
      if (midiEvents.length > 0) {
        for (const plugin of activePlugins) {
          plugin.audioNode.scheduleEvents(...midiEvents);
        }
      }
      return origScheduleEvents(...events);
    };

    // フック2: AudioWorkletから戻ってくるMIDIイベント用（再生時のMIDIプレイヤー等）
    // MIDIPlayerProcessor → emitEvents → PassthroughWAMProcessor → メインスレッドに書き戻し
    // → PassthroughWAMNode上でCustomEvent('wam-midi')が発火される
    const midiEventListener = (e: Event) => {
      const event = (e as CustomEvent).detail;
      if (event) {
        for (const plugin of activePlugins) {
          plugin.audioNode.scheduleEvents(event);
        }
      }
    };
    (inputNode as any)._midiEventListener = midiEventListener;
    inputNode.addEventListener('wam-midi', midiEventListener);

    this.element.hasPlugin = true
  }

  /**
   * Add a plugin to the end of the rack.
   */
  public async addPlugin(plugin: Plugin): Promise<PluginInstance | null> {
    const pluginInstance = await plugin.instantiate(this.audioContext, this.groupId)
    if (!pluginInstance) return null

    this._plugins.push(pluginInstance)

    // Listen for parameter changes
    pluginInstance.audioNode.addEventListener("wam-info", () => {
      if (this.onPluginParamChange) this.onPluginParamChange(this);
    });

    this.updatePluginRouting()
    return pluginInstance
  }

  /**
   * Remove a plugin by its index in the rack.
   */
  public removePlugin(index: number) {
    if (index < 0 || index >= this._plugins.length) return
    const pluginInstance = this._plugins[index]
    this._plugins.splice(index, 1)

    this.updatePluginRouting()
    pluginInstance.dispose()
  }

  public removeAllPlugins() {
    const pluginsToDispose = [...this._plugins]
    this._plugins = []
    this.updatePluginRouting()
    for (const p of pluginsToDispose) {
      p.dispose()
    }
  }

  /**
   * (Deprecated: For backward compatibility with older connections)
   */
  public async connectPlugin(plugin: Plugin | null) {
    this.removeAllPlugins()
    if (plugin) {
      await this.addPlugin(plugin)
    }
  }


  public abstract play(): void

  public abstract pause(): void


  /** LOOP */
  private _loop_range: [number, number] | null = null
  get loopRange(): [number, number] | null { return this._loop_range == null ? null : [...this._loop_range] }

  setLoop(range: [number, number] | null) {
    this._loop_range = range
  }

  /** The playhead positions of the track in milliseconds. */
  public abstract playhead: number

  /**
   * The modified state of the track. It is used to know if the track has been modified and should be updated.
   */
  public set modified(value: boolean) { this._modified = value }
  public get modified(): boolean { return this._isModified(this._modified) }

  /**
   * Override this method to add more conditions to the modified state.
   * @returns 
   */
  protected _isModified(decorated: boolean): boolean { return decorated }


  /** Audio Graph Creation */
  /**
   * Get the sound provider graph of this sound provider.
   */
  public get sound_provider_graph() {
    const that = this
    return this._sound_provider_graph = this._sound_provider_graph ?? {
      async instantiate(audioContext: BaseAudioContext, groupId: string) {
        // Create the graph
        const gainNode = audioContext.createGain()
        gainNode.gain.value = that.gainNode.gain.value

        const pannerNode = audioContext.createStereoPanner()
        pannerNode.pan.value = that.pannerNode.pan.value
        pannerNode.connect(gainNode)

        const plugin_instances: PluginInstance[] = []
        for (const p of that.plugins) {
          const inst = await p.cloneInto(audioContext, groupId)
          if (inst) plugin_instances.push(inst)
        }

        return new SoundProviderGraphInstance(gainNode, pannerNode, plugin_instances, groupId, that.isGlobalPluginBypass)
      }
    }
  }

  private _sound_provider_graph: AudioGraph<SoundProviderGraphInstance> | null = null

  public get gainParameter(): AudioParam { return this.gainNode.gain }
  public get panParameter(): AudioParam { return this.pannerNode.pan }

  /**
   * Updates the UI (sliders) based on the current AudioParam values.
   * This allows automation to move the sliders visually.
   */
  public updateDisplay() {
    // Avoid interrupting user interaction
    if (document.activeElement === this.element.volumeSlider) {
      // User is dragging volume, don't update
    } else {
      const currentGain = this.gainNode.gain.value;
      this.element.volumeSlider.value = (currentGain * 100).toFixed(1);
    }

    if (document.activeElement === this.element.balanceSlider) {
      // User is dragging pan
    } else {
      const currentPan = this.pannerNode.pan.value;
      this.element.balanceSlider.value = currentPan.toFixed(2);
    }
  }

}


export class SoundProviderGraphInstance {

  constructor(
    public gainNode: GainNode,
    public pannerNode: StereoPannerNode,
    public plugins: PluginInstance[],
    public groupId: string,
    public isGlobalPluginBypass: boolean = false
  ) {
    this.updateRouting()
  }

  updateRouting() {
    const activePlugins = this.isGlobalPluginBypass ? [] : this.plugins.filter(p => !p.isBypassed);
    if (activePlugins.length === 0) {
      // Input goes straight to panner? SoundProviderGraphInstance's inputNode is where clients connect.
      // Wait, let's look at `get inputNode()`.
    } else {
      for (let i = 0; i < activePlugins.length - 1; i++) {
        activePlugins[i].audioNode.connect(activePlugins[i + 1].audioNode)
        activePlugins[i].audioNode.connectEvents(activePlugins[i + 1].audioNode.instanceId)
      }
      activePlugins[activePlugins.length - 1].audioNode.connect(this.pannerNode)
    }
  }

  connect(destination: AudioNode): void { this.gainNode.connect(destination) }
  disconnect(destination?: AudioNode): void { destination ? this.gainNode.disconnect(destination) : this.gainNode.disconnect() }

  connectEvents(destination: WamNode): void {
    if (this.plugins.length > 0) {
      this.plugins[this.plugins.length - 1].audioNode.connectEvents(destination.instanceId)
    }
  }
  disconnectEvents(destination?: WamNode | undefined): void {
    if (this.plugins.length > 0) {
      if (destination) this.plugins[this.plugins.length - 1].audioNode.disconnectEvents(destination.instanceId)
      else this.plugins[this.plugins.length - 1].audioNode.disconnectEvents()
    }
  }

  dispose(): void {
    this.gainNode.disconnect()
    this.pannerNode.disconnect()
    for (const p of this.plugins) { p.dispose() }
  }

  get inputNode() {
    const activePlugins = this.isGlobalPluginBypass ? [] : this.plugins.filter(p => !p.isBypassed);
    return activePlugins.length > 0 ? activePlugins[0].audioNode : this.pannerNode;
  }
}

