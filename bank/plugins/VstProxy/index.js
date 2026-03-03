import WebAudioModule from "../utils/sdk/src/WebAudioModule.js";
import CompositeAudioNode from "../utils/sdk-parammgr/src/CompositeAudioNode.js";
import ParamMgrFactory from "../utils/sdk-parammgr/src/ParamMgrFactory.js";

// VstProxy用のCompositeAudioNode
// ParamMgrNode（本物のWamNode/AudioWorkletNode）に委譲し、MIDIイベントをTauriに転送する
class VstProxyNode extends CompositeAudioNode {
    /** @type {string | null} */
    vstPath = null;

    /** @type {AudioWorkletNode | null} */
    _audioOutputNode = null;

    /** @type {number | null} */
    _audioPollingInterval = null;

    setup(paramMgr) {
        this._wamNode = paramMgr;


        // MIDIをTauriに送信する共通関数
        const forwardMidiToTauri = (bytes) => {
            if (!bytes || bytes.length < 3 || !window.__TAURI__ || !this.vstPath) return;
            const status = bytes[0];
            const data1 = bytes[1];
            const data2 = bytes[2];
            if ((status & 0xF0) === 0x90 || (status & 0xF0) === 0x80) {

                window.__TAURI__.core.invoke("send_vst_midi", {
                    path: this.vstPath,
                    status,
                    data1,
                    data2
                }).catch(err => console.error("VST MIDI failed:", err));
            }
        };

        // 方法1: connectEvents経由でWorkletから戻ってきたMIDIイベントをCustomEventでキャッチ
        paramMgr.addEventListener('wam-midi', (e) => {
            const midiData = e.detail?.data;
            if (midiData) forwardMidiToTauri(midiData.bytes);
        });

        // 方法2: ParamMgrNode.scheduleEventsをモンキーパッチしてMIDIを直接キャッチ
        // connectEvents経由でもメインスレッドのscheduleEventsが呼ばれる場合があるため
        const origScheduleEvents = paramMgr.scheduleEvents.bind(paramMgr);
        paramMgr.scheduleEvents = (...events) => {
            for (const event of events) {
                if (event.type === 'wam-midi') {
                    forwardMidiToTauri(event.data?.bytes);
                }
            }
            return origScheduleEvents(...events);
        };
    }

    scheduleEvents(...events) {
        // 直接MIDIをRustへ転送する

        for (const e of events) {
            if (e.type === 'wam-midi') {
                const bytes = e.data?.bytes;
                if (bytes && bytes.length >= 3 && window.__TAURI__ && this.vstPath) {
                    const status = bytes[0];
                    const data1 = bytes[1];
                    const data2 = bytes[2];
                    if ((status & 0xF0) === 0x90 || (status & 0xF0) === 0x80) {
                        console.log('[VstProxy] Forwarding MIDI to Tauri:', status, data1, data2);
                        window.__TAURI__.core.invoke("send_vst_midi", {
                            path: this.vstPath,
                            status,
                            data1,
                            data2
                        }).catch(e => console.error("VST MIDI failed:", e));
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
                    
                    this.port.onmessage = (e) => {
                        if (e.data.type === 'audio') {
                            this.chunksL.push(e.data.left);
                            this.chunksR.push(e.data.right);
                            this.totalBuffered += e.data.left.length;
                            
                            // リアルタイム性を保つため、バッファ上限を4096サンプル（約92ms）に制限
                            // これを超えたぶんの古いオーディオチャンクは即座に破棄して最新に追いつく
                            const MAX_BUFFER = 4096;
                            while (this.totalBuffered > MAX_BUFFER && this.chunksL.length > 1) {
                                let dropped = this.chunksL.shift().length;
                                this.chunksR.shift();
                                this.totalBuffered -= dropped;
                                this.readOffset = 0;
                            }
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

            // ポーリング開始
            this.startAudioPolling();
        } catch (e) {
            console.error("Failed to setup AudioWorklet for VST:", e);
        } finally {
            URL.revokeObjectURL(url);
        }
    }

    startAudioPolling() {
        if (this._audioPollingInterval) return;

        // 10ms間隔でオーディオを取得するようにポーリングを高速化
        const sampleRate = this.context.sampleRate || 44100;
        // 1回のポーリングで多めに取得要求し、Rust側のバッファから根こそぎ取得する
        const reqSamples = Math.floor(sampleRate * 0.05);

        let isFetching = false;

        this._audioPollingInterval = setInterval(async () => {
            if (!this.vstPath || !window.__TAURI__ || isFetching) return;

            isFetching = true;
            try {
                const response = await window.__TAURI__.core.invoke("get_vst_audio", {
                    path: this.vstPath,
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
                        // メモリアラインメント(`% 4 !== 0`)のエラーを防ぐため、スライスして独立したバッファを作成
                        const leftBytes = new Uint8Array(bytes.buffer, bytes.byteOffset + 4, samplesCount * 4);
                        const rightBytes = new Uint8Array(bytes.buffer, bytes.byteOffset + 4 + samplesCount * 4, samplesCount * 4);

                        const left = new Float32Array(leftBytes.slice().buffer);
                        const right = new Float32Array(rightBytes.slice().buffer);

                        this._audioOutputNode.port.postMessage({
                            type: 'audio',
                            left: left,
                            right: right
                        });
                    }
                }
            } catch (e) {
                // Ignore empty or error during load
            } finally {
                isFetching = false;
            }
        }, 10); // 10ms (100FPS) down from 20ms
    }

    destroy() {
        if (this._audioPollingInterval) {
            clearInterval(this._audioPollingInterval);
            this._audioPollingInterval = null;
        }
        if (this._audioOutputNode) {
            this._audioOutputNode.disconnect();
            this._audioOutputNode = null;
        }
        super.destroy();
    }

    /** VSTへのパスを設定する */
    setVstPath(path) {
        this.vstPath = path;
    }

    /** VSTのGUIを開く */
    async showVstUi() {
        if (window.__TAURI__ && this.vstPath) {
            try {
                await window.__TAURI__.core.invoke("open_vst_editor", { path: this.vstPath });
            } catch (e) {
                console.error("Failed to open VST editor", e);
            }
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
            node.setVstPath(initialState.vstPath);
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
