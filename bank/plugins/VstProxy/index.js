import WebAudioModule from "../utils/sdk/src/WebAudioModule.js";
import CompositeAudioNode from "../utils/sdk-parammgr/src/CompositeAudioNode.js";
import ParamMgrFactory from "../utils/sdk-parammgr/src/ParamMgrFactory.js";

// VstProxy用のCompositeAudioNode
// ParamMgrNode（本物のWamNode/AudioWorkletNode）に委譲し、MIDIイベントをTauriに転送する
class VstProxyNode extends CompositeAudioNode {
    /** @type {string | null} */
    vstPath = null;

    /** @type {number | null} */
    instanceId = null;

    /** @type {AudioWorkletNode | null} */
    _audioOutputNode = null;

    /** @type {number | null} */
    _audioPollingInterval = null;

    setup(paramMgr) {
        this._wamNode = paramMgr;

        // MIDIをTauriに送信する共通関数
        const forwardMidiToTauri = (bytes) => {
            if (!bytes || bytes.length < 3 || !window.__TAURI__ || this.instanceId == null) return;
            const status = bytes[0];
            const data1 = bytes[1];
            const data2 = bytes[2];
            if ((status & 0xF0) === 0x90 || (status & 0xF0) === 0x80) {

                window.__TAURI__.core.invoke("send_vst_midi", {
                    instanceId: this.instanceId,
                    status,
                    data1,
                    data2
                }).catch(err => console.error("VST MIDI failed:", err));
            }
        };

        // Note: WAMからのMIDIイベントは paramMgr.addEventListener と paramMgr.scheduleEvents モンキーパッチで重複して送信されるバグがあったため削除しました。
        // 今後は VstProxyNode 自身の scheduleEvents のみで処理します。
    }

    scheduleEvents(...events) {
        // 直接MIDIをRustへ転送する

        for (const e of events) {
            if (e.type === 'wam-midi') {
                const bytes = e.data?.bytes;
                if (bytes && bytes.length >= 3 && window.__TAURI__ && this.instanceId != null) {
                    const status = bytes[0];
                    const data1 = bytes[1];
                    const data2 = bytes[2];
                    if ((status & 0xF0) === 0x90 || (status & 0xF0) === 0x80) {
                        const now = this.context.currentTime;
                        const eventTime = e.time !== undefined ? e.time : now;
                        let delayMs = (eventTime - now) * 1000;

                        // Minimum scheduling bounds
                        if (delayMs < 0) delayMs = 0;

                        // Note Off might be scheduled far in advance by DAWIY MIDIPlayerProcessor
                        if (delayMs > 0) {
                            setTimeout(() => {
                                if (!window.__TAURI__ || this.instanceId == null) return;
                                window.__TAURI__.core.invoke("send_vst_midi", {
                                    instanceId: this.instanceId,
                                    status,
                                    data1,
                                    data2
                                }).catch(err => console.error("VST MIDI failed:", err));
                            }, delayMs);
                        } else {
                            if (!window.__TAURI__ || this.instanceId == null) return;
                            window.__TAURI__.core.invoke("send_vst_midi", {
                                instanceId: this.instanceId,
                                status,
                                data1,
                                data2
                            }).catch(err => console.error("VST MIDI failed:", err));
                        }
                    }
                }
            }
        }
        // WAMへのイベントスケジュールも維持する
        if (this._wamNode && this._wamNode.scheduleEvents) {
            this._wamNode.scheduleEvents(...events);
        }
    }

    /** 
     * オーディオ出力を処理するAudioWorkletNodeを接続する
     * CompositeAudioNode の _output に接続して最終的な音を出す
     */
    async setupAudioOutput() {
        if (!this.context.audioWorklet) return;

        // ランダムなIDを生成して重複登録エラーを回避
        const uniqueId = Math.random().toString(36).substring(2, 9);
        const processorName = `vst-audio-output-processor-${uniqueId}`;

        // VstAudioOutputProcessor のソースコードをBlobで作成
        const processorCode = `
            class VstAudioOutputProcessor extends AudioWorkletProcessor {
                constructor() {
                    super();
                    this.chunksL = [];
                    this.chunksR = [];
                    this.readOffset = 0;
                    this.totalBuffered = 0;
                    this.framesSinceLastReport = 0;
                    this.consumedSinceLastReport = 0;
                    this.hadUnderrun = false;
                    
                    this.port.onmessage = (e) => {
                        if (e.data.type === 'audio') {
                            this.chunksL.push(e.data.left);
                            this.chunksR.push(e.data.right);
                            this.totalBuffered += e.data.left.length;
                        }
                    };
                }

                process(inputs, outputs, parameters) {
                    const output = outputs[0];
                    if (!output || output.length < 2) return true;

                    const channelL = output[0];
                    const channelR = output[1];
                    const outLen = channelL.length;

                    // アンダーラン防止のための最小バッファサイズ
                    // もしバッファが足りない場合はゼロ埋め（ミュート）してバッファが溜まるのを待つ
                    if (this.totalBuffered < outLen) {
                        for (let i = 0; i < outLen; i++) {
                            channelL[i] = 0;
                            channelR[i] = 0;
                        }
                        
                        this.hadUnderrun = true;
                        this.framesSinceLastReport += outLen;
                        this.consumedSinceLastReport += outLen; // Treat zeroes as consumed time too
                        
                        if (this.framesSinceLastReport >= 2048) {
                            this.port.postMessage({ 
                                type: 'buffer_status', 
                                consumed: this.consumedSinceLastReport,
                                underrun: this.hadUnderrun 
                            });
                            this.framesSinceLastReport = 0;
                            this.consumedSinceLastReport = 0;
                            this.hadUnderrun = false;
                        }
                        return true;
                    }

                    for (let i = 0; i < outLen; i++) {
                        let currentChunkL = this.chunksL[0];
                        let currentChunkR = this.chunksR[0];
                        
                        channelL[i] = currentChunkL[this.readOffset];
                        channelR[i] = currentChunkR[this.readOffset];
                        
                        this.readOffset++;
                        this.totalBuffered--;

                        if (this.readOffset >= currentChunkL.length) {
                            this.chunksL.shift();
                            this.chunksR.shift();
                            this.readOffset = 0;
                        }
                    }
                    
                    this.framesSinceLastReport += outLen;
                    this.consumedSinceLastReport += outLen;
                    if (this.framesSinceLastReport >= 2048) {
                        this.port.postMessage({ 
                            type: 'buffer_status', 
                            consumed: this.consumedSinceLastReport,
                            underrun: this.hadUnderrun
                        });
                        this.framesSinceLastReport = 0;
                        this.consumedSinceLastReport = 0;
                        this.hadUnderrun = false;
                    }
                    
                    return true;
                }
            }
            registerProcessor('${processorName}', VstAudioOutputProcessor);
        `;

        const blob = new Blob([processorCode], { type: 'application/javascript' });
        const url = URL.createObjectURL(blob);
        try {
            await this.context.audioWorklet.addModule(url);
            this._audioOutputNode = new window.AudioWorkletNode(this.context, processorName, {
                numberOfInputs: 0,
                numberOfOutputs: 1,
                outputChannelCount: [2]
            });

            // CompositeAudioNodeの出力として設定
            this._output = this._audioOutputNode;

            this.currentBuffered = 0;
            this.isFetching = false;
            this._audioOutputNode.port.onmessage = (e) => {
                if (e.data.type === 'buffer_status') {
                    this.currentBuffered = Math.max(0, this.currentBuffered - e.data.consumed);

                    if (e.data.underrun && this.instanceId != null) {
                        console.warn("[VstProxy] VST Audio Buffer Underrun! (Stutter detected)");
                    }

                    // バッファが減ってきたら即座に補充
                    if (this.currentBuffered < 8192) {
                        this.fetchAudio();
                    }
                }
            };

            // 重要: CompositeAudioNode(GainNode)の_outputをオーバーライドすると、
            // GainNode自体の出力がどこにも接続されなくなる。
            // すると上流のaudioInputNode→junctionNode→MIDIPlayerNodeの全チェーンが
            // destinationに到達しない「孤立サブグラフ」になり、
            // Chromiumの最適化でMIDIPlayerProcessor.process()がスキップされてしまう。
            // これを防ぐためGainNode自体をミュートしてdestinationに接続し、
            // 上流のprocessチェーンを維持する。
            const silentGain = this.context.createGain();
            silentGain.gain.value = 0;
            GainNode.prototype.connect.call(this, silentGain);
            silentGain.connect(this.context.destination);

            // 音声取得ループ開始
            this.fetchAudio();
        } catch (e) {
            console.error("Failed to setup AudioWorklet for VST:", e);
        } finally {
            URL.revokeObjectURL(url);
        }
    }

    async fetchAudio() {
        if (this.instanceId == null || !window.__TAURI__ || this.isFetching) return;

        const reqSamples = 2048;
        const TARGET_BUFFER = 8192; // 十分なバッファを持たせて途切れを完全防止

        if (this.currentBuffered > TARGET_BUFFER) return;

        this.isFetching = true;
        try {
            const response = await window.__TAURI__.core.invoke("get_vst_audio", {
                instanceId: this.instanceId,
                reqSamples: reqSamples
            });

            const responseLength = response?.byteLength ?? response?.length;
            if (response && responseLength > 4) {
                const bytes = response instanceof ArrayBuffer ? new Uint8Array(response)
                    : response instanceof Uint8Array ? response
                        : new Uint8Array(response);
                const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
                const samplesCount = view.getUint32(0, true);

                if (samplesCount > 0 && this._audioOutputNode) {
                    const leftBytes = new Uint8Array(bytes.buffer, bytes.byteOffset + 4, samplesCount * 4);
                    const rightBytes = new Uint8Array(bytes.buffer, bytes.byteOffset + 4 + samplesCount * 4, samplesCount * 4);

                    const left = new Float32Array(leftBytes.slice().buffer);
                    const right = new Float32Array(rightBytes.slice().buffer);

                    this._audioOutputNode.port.postMessage({
                        type: 'audio',
                        left: left,
                        right: right
                    });

                    // Workletからの通知を待たずにローカルの推測値を更新
                    this.currentBuffered += samplesCount;
                }
            }
        } catch (e) {
            console.error("VST audio fetch failed:", e);
            // サーバーエラーなどで無限ループが走りブラウザがフリーズするのを防ぐ
            await new Promise(r => setTimeout(r, 1000));
        } finally {
            this.isFetching = false;
            // まだ目標に達していなければ連続で取得
            if (this.currentBuffered < TARGET_BUFFER) {
                this.fetchAudio();
            }
        }
    }

    destroy() {
        this.isFetching = true; // prevent further fetches
        if (this._audioOutputNode) {
            this._audioOutputNode.port.onmessage = null;
            this._audioOutputNode.port.close();
            this._audioOutputNode.disconnect();
            this._audioOutputNode = null;
        }

        if (this.instanceId != null && window.__TAURI__) {
            try {
                window.__TAURI__.core.invoke("close_vst_editor", { instanceId: this.instanceId })
                    .catch(err => console.error("Failed to close VST editor:", err));
            } catch (e) {
                console.error(e);
            }
            this.instanceId = null;
        }

        super.destroy();
    }

    /** VSTへのパスを設定する */
    async setVstPath(path) {
        if (this.vstPath === path && this.instanceId != null) return;
        this.vstPath = path;

        if (window.__TAURI__) {
            try {
                const sampleRate = this.context.sampleRate || 48000;
                this.instanceId = await window.__TAURI__.core.invoke("open_vst_editor", {
                    path: this.vstPath,
                    sampleRate: sampleRate
                });
                console.log(`[VstProxy] VST Loaded with instanceId: ${this.instanceId}`);
                if (this._audioOutputNode) {
                    this.fetchAudio();
                }
            } catch (e) {
                console.error("Failed to load VST", e);
            }
        }
    }

    /** VSTのGUIを開く（現在フォーカスを当てるだけの動作は未実装のため何もしません） */
    async showVstUi() {
        if (window.__TAURI__ && this.instanceId != null) {
            console.log("showVstUi called, instanceId:", this.instanceId);
            window.__TAURI__.core.invoke("show_vst_editor", { instanceId: this.instanceId }).catch(e => console.error(e));
        }
    }

    // getState/setState を上書きしてvstPathも保存する
    async getState() {
        const parentState = await super.getState();
        return { ...parentState, vstPath: this.vstPath };
    }

    async setState(state) {
        if (state?.vstPath) {
            this.setVstPath(state.vstPath);
        }
        return super.setState(state);
    }
}

const getBaseUrl = (relativeURL) => {
    const baseURL = relativeURL.href.substring(0, relativeURL.href.lastIndexOf("/"));
    return baseURL;
};

// === VstProxy WAM Module ===
export default class VstProxy extends WebAudioModule {
    _baseURL = getBaseUrl(new URL(".", import.meta.url));
    _descriptorUrl = `${this._baseURL}/descriptor.json`;

    async _loadDescriptor() {
        const url = this._descriptorUrl;
        if (!url) throw new TypeError("Descriptor not found");
        const response = await fetch(url);
        const descriptor = await response.json();
        Object.assign(this.descriptor, descriptor);
    }

    async initialize(state) {
        await this._loadDescriptor();
        console.log("[VstProxy] Initializing with state:", state);
        return super.initialize(state);
    }

    async createAudioNode(initialState) {
        // ParamMgrFactory を使って標準的なWamNode(ParamMgrNode)を生成する
        // これにより AudioWorkletProcessor が正しく登録・初期化される
        const paramMgrNode = await ParamMgrFactory.create(this, {
            internalParamsConfig: {},  // VstProxyにはWebAudioパラメータは不要
        });

        // CompositeAudioNode を作り、ParamMgrNode に委譲させる
        const node = new VstProxyNode(this.audioContext);
        node.setup(paramMgrNode);

        // オーディオ出力用のWorkletをセットアップ
        await node.setupAudioOutput();

        // VSTパスを設定
        if (initialState?.vstPath) {
            await node.setVstPath(initialState.vstPath);
        }

        if (initialState) node.setState(initialState);

        return node;
    }

    createGui() {
        const div = document.createElement('div');
        div.style.background = "#333";
        div.style.color = "#eee";
        div.style.padding = "10px";
        div.style.fontFamily = "sans-serif";
        div.style.textAlign = "center";
        div.innerHTML = `
            <h3>VST3 Plugin</h3>
            <p>Proxy for Native VST3</p>
            <button id="open-vst-btn" style="padding: 8px 16px; cursor: pointer;">Open VST Interface</button>
        `;

        const btn = div.querySelector("#open-vst-btn");
        btn.onclick = () => {
            if (this.audioNode?.showVstUi) this.audioNode.showVstUi();
        };

        return div;
    }
}
