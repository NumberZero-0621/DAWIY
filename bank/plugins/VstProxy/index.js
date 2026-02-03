import WebAudioModule from "../utils/sdk/src/WebAudioModule.js";

class VstProxyNode extends AudioWorkletNode {
    constructor(context) {
        super(context, "vst-proxy-processor");
    }
}


const getBasetUrl = (relativeURL) => {
    const baseURL = relativeURL.href.substring(0, relativeURL.href.lastIndexOf("/"));
    return baseURL;
};

export default class VstProxy extends WebAudioModule {
    _baseURL = getBasetUrl(new URL(".", import.meta.url));
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

        // This is where we receive the VST path
        // state should contain { vstPath: "..." }
        console.log("Initializing VST Proxy with state:", state);

        // For now, bypass
        return super.initialize(state);
    }

    async createAudioNode(initialState) {
        // Just a simple Gain node for now to pass audio through
        const node = this.audioContext.createGain();

        // Store VST info
        node.vstPath = initialState ? initialState.vstPath : null;

        // Add a "Show UI" method that the host can call
        node.showVstUi = async () => {
            if (window.__TAURI__) {
                const { invoke } = window.__TAURI__.core; // Or .tauri depending on version
                try {
                    console.log("Requesting to open VST editor for:", node.vstPath);
                    await invoke("open_vst_editor", { path: node.vstPath });
                    // alert("VST Editor Open Request sent for: " + node.vstPath);
                } catch (e) {
                    console.error("Failed to open VST editor", e);
                }
            } else {
                alert("VST hosting only available in Desktop mode.");
            }
        };

        // Add WAM state methods required by Plugin.ts
        node.setState = async (state) => {
            if (state && state.vstPath) {
                node.vstPath = state.vstPath;
            }
        };

        node.getState = async () => {
            return { vstPath: node.vstPath };
        };

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
            if (this.audioNode.showVstUi) this.audioNode.showVstUi();
        };

        return div;
    }
}
