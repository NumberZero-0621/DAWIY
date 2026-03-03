import WebAudioModule from "../utils/sdk/src/WebAudioModule.js";
import CompositeAudioNode from "../utils/sdk-parammgr/src/CompositeAudioNode.js";
import ParamMgrFactory from "../utils/sdk-parammgr/src/ParamMgrFactory.js";

// VstProxy用のCompositeAudioNode
// ParamMgrNode（本物のWamNode/AudioWorkletNode）に委譲し、MIDIイベントをTauriに転送する
class VstProxyNode extends CompositeAudioNode {
    /** @type {string | null} */
    vstPath = null;

    setup(paramMgr) {
        this._wamNode = paramMgr;
        // ParamMgrNodeが受け取ったwam-midiイベントをlistenしてTauriに転送する
        paramMgr.addEventListener("wam-midi", (e) => {
            const bytes = e.detail?.data?.bytes;
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
        });
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
