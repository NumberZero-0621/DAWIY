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

    // 外部からパラメータ一覧を取得する（DAW側からの要求）
    async getParameterInfo(...parameterIds) {
        if (!window.__TAURI__ || this.instanceId == null) return {};
        
        try {
            const params = await window.__TAURI__.core.invoke("get_vst_parameters", { instanceId: this.instanceId });
            
            const result = {};
            for (const p of params) {
                result[p.id.toString()] = {
                    id: p.id.toString(),
                    label: p.title || p.short_title || `Param ${p.id}`,
                    type: p.step_count > 0 ? "discrete" : "float",
                    minValue: 0,
                    maxValue: 1,
                    defaultValue: p.default_value
                };
            }
            if (parameterIds && parameterIds.length > 0) {
                const filtered = {};
                for (const id of parameterIds) {
                    if (result[id]) filtered[id] = result[id];
                }
                return filtered;
            }
            return result;
        } catch (e) {
            console.error("Failed to get VST parameters:", e);
            return {};
        }
    }

    // パラメータ値の取得
    async getParameterValues(normalized, ...parameterIds) {
        if (!window.__TAURI__ || this.instanceId == null) return {};
        if (!parameterIds || parameterIds.length === 0) return {};
        
        try {
            const result = {};
            for (const id of parameterIds) {
                const val = await window.__TAURI__.core.invoke("get_vst_parameter", { 
                    instanceId: this.instanceId, 
                    paramId: parseInt(id) 
                });
                result[id.toString()] = {
                    id: id.toString(),
                    value: val,
                    normalized: normalized
                };
            }
            return result;
        } catch (e) {
            console.error("Failed to get VST parameter value:", e);
            return {};
        }
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
            } else if (e.type === 'wam-automation') {
                const data = e.data;
                if (data && data.id && data.value !== undefined && window.__TAURI__ && this.instanceId != null) {
                    const now = this.context.currentTime;
                    const eventTime = e.time !== undefined ? e.time : now;
                    let delayMs = (eventTime - now) * 1000;
                    if (delayMs < 0) delayMs = 0;

                    const sendParam = () => {
                        if (!window.__TAURI__ || this.instanceId == null) return;
                        window.__TAURI__.core.invoke("set_vst_parameter", {
                            instanceId: this.instanceId,
                            paramId: parseInt(data.id),
                            value: data.value
                        }).catch(err => console.error("VST Param failed:", err));
                    };

                    if (delayMs > 0) {
                        setTimeout(sendParam, delayMs);
                    } else {
                        sendParam();
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
                    // 出力用キュー
                    this.chunksL = [];
                    this.chunksR = [];
                    this.readOffset = 0;
                    this.totalBuffered = 0;
                    
                    // 入力用キュー
                    this.inChunksL = [];
                    this.inChunksR = [];
                    this.inOffsets = 0;
                    this.inTotalBuffered = 0;

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

                    const input = inputs[0] || [[], []]; // 1つ目のインプットバス
                    const inChannelL = input[0] || new Float32Array(output[0].length);
                    const inChannelR = input[1] || new Float32Array(output[0].length);

                    const channelL = output[0];
                    const channelR = output[1];
                    const outLen = channelL.length;

                    // 1. 入力を蓄積する
                    this.inChunksL.push(new Float32Array(inChannelL));
                    this.inChunksR.push(new Float32Array(inChannelR));
                    this.inTotalBuffered += outLen;

                    // 一定量（1024サンプル等）溜まったらメインスレッドへ送信
                    if (this.inTotalBuffered >= 1024) {
                        const mergedL = new Float32Array(this.inTotalBuffered);
                        const mergedR = new Float32Array(this.inTotalBuffered);
                        let offset = 0;
                        while(this.inChunksL.length > 0) {
                            const chunkL = this.inChunksL.shift();
                            const chunkR = this.inChunksR.shift();
                            mergedL.set(chunkL, offset);
                            mergedR.set(chunkR, offset);
                            offset += chunkL.length;
                        }
                        this.inTotalBuffered = 0;
                        this.port.postMessage({
                            type: 'audio_input',
                            left: mergedL,
                            right: mergedR
                        });
                    }

                    // 2. 出力を処理する
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
                numberOfInputs: 1, // ステレオオーディオ入力を受け取る
                numberOfOutputs: 1,
                outputChannelCount: [2] // 出力はステレオ
            });

            // CompositeAudioNodeの入出力として設定
            // トラックからの入力は_audioOutputNode（VstAudioOutputProcessor）で受け取る
            // 出力も_audioOutputNodeから取る（サイレントゲイン用には別途繋ぐ）
            this._input = this._audioOutputNode;
            this._output = this._audioOutputNode;

            this.currentBuffered = 0;
            this.isFetching = false;

            // 入力オーディオ用バッファ（Workletからメインスレッドへの転送用）
            this.inputAudioQueueL = [];
            this.inputAudioQueueR = [];
            this.inputAudioBuffered = 0;

            this._audioOutputNode.port.onmessage = (e) => {
                if (e.data.type === 'buffer_status') {
                    this.currentBuffered = Math.max(0, this.currentBuffered - e.data.consumed);
                    // underrun警告は初期待機時等にも出るため削除
                } else if (e.data.type === 'audio_input') {
                    // Workletからの入力を受け取る
                    this.inputAudioQueueL.push(e.data.left);
                    this.inputAudioQueueR.push(e.data.right);
                    this.inputAudioBuffered += e.data.left.length;

                    // サーバーへプッシュ
                    this.pushAudioProcess();
                }
            };

            // _input, _output の設定
            // CompositeAudioNode は自身が GainNode であり、Trackからの connect(VST) は this に繋がる。
            // よって this の入力を _audioOutputNode (Worklet) に流し込む。
            GainNode.prototype.connect.call(this, this._audioOutputNode);

            // 出力は _audioOutputNode が担う
            this._output = this._audioOutputNode;

            // 音声取得ループ開始（初期バッファリング用）
            this.pushAudioProcess();
        } catch (e) {
            console.error("Failed to setup AudioWorklet for VST:", e);
        } finally {
            URL.revokeObjectURL(url);
        }
    }

    async pushAudioProcess() {
        if (this.instanceId == null || !window.__TAURI__ || this.isFetching) return;

        // レイテンシ削減のため、1回あたりの処理サンプル数と目標バッファ量を半減
        const reqSamples = 1024;
        const TARGET_BUFFER = 4096;

        if (this.currentBuffered > TARGET_BUFFER) return;

        this.isFetching = true;
        try {
            let in_l = new Float32Array(reqSamples);
            let in_r = new Float32Array(reqSamples);

            // バッファに入力波形があれば取り出す
            if (this.inputAudioBuffered >= reqSamples) {
                let offset = 0;
                while (offset < reqSamples && this.inputAudioQueueL.length > 0) {
                    let chunkL = this.inputAudioQueueL[0];
                    let chunkR = this.inputAudioQueueR[0];

                    let take = Math.min(chunkL.length, reqSamples - offset);
                    in_l.set(chunkL.subarray(0, take), offset);
                    in_r.set(chunkR.subarray(0, take), offset);

                    offset += take;
                    this.inputAudioBuffered -= take;

                    if (take < chunkL.length) {
                        this.inputAudioQueueL[0] = chunkL.subarray(take);
                        this.inputAudioQueueR[0] = chunkR.subarray(take);
                    } else {
                        this.inputAudioQueueL.shift();
                        this.inputAudioQueueR.shift();
                    }
                }
            } else {
                // 入力が足りない場合（またはインストゥルメントの場合）はゼロ埋め（初期化済みなのでそのまま）
                // ただしキューを空にしておく（遅延蓄積防止）
                this.inputAudioQueueL = [];
                this.inputAudioQueueR = [];
                this.inputAudioBuffered = 0;
            }

            // Rust側はFloat32を期待しているので、ArrayBuffer (Uint8Array) に変換して送信
            const reqBufL = new Uint8Array(in_l.buffer);
            const reqBufR = new Uint8Array(in_r.buffer);

            const response = await window.__TAURI__.core.invoke("process_vst_audio", {
                instanceId: this.instanceId,
                reqSamples: reqSamples,
                inputLBytes: Array.from(reqBufL),
                inputRBytes: Array.from(reqBufR)
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
            console.error("VST process_audio failed:", e);
            // サーバーエラーなどで無限ループが走りブラウザがフリーズするのを防ぐ
            await new Promise(r => setTimeout(r, 1000));
        } finally {
            this.isFetching = false;
            // 未処理の入力がまだあれば連続で処理
            if (this.inputAudioBuffered >= 1024) {
                this.pushAudioProcess();
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

    _isLoadingVst = false;

    /** VSTへのパスを設定する */
    async setVstPath(path, visible = false) {
        if (this._isLoadingVst) return;
        if (this.vstPath === path && this.instanceId != null) return;
        this._isLoadingVst = true;
        this.vstPath = path;

        if (window.__TAURI__) {
            try {
                const sampleRate = this.context.sampleRate || 48000;
                this.instanceId = await window.__TAURI__.core.invoke("open_vst_editor", {
                    path: this.vstPath,
                    sampleRate: sampleRate,
                    visible: visible
                });
                console.log(`[VstProxy] VST Loaded with instanceId: ${this.instanceId}`);
                if (this._audioOutputNode) {
                    this.pushAudioProcess();
                }
            } catch (e) {
                console.error("Failed to load VST", e);
            }
        }
        this._isLoadingVst = false;
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
            await this.setVstPath(state.vstPath, !!state._guiVisible);
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
            await node.setVstPath(initialState.vstPath, !!initialState._guiVisible);
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
