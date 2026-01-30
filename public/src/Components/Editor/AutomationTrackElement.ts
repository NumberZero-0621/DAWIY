import { HEIGHT_AUTOMATION } from "../../Env";
import { doc } from "../../Utils/dom";

const template = doc/*html*/`
<style>
:host {
    display: flex;
    width: 100%;
    /* height set in JS */
    flex-direction: row;
    flex-wrap: nowrap;
    justify-content: flex-start;
    align-items: center;
    background: #1e1e1e;
    border-bottom: solid 1px black;
    border-left: solid 1px black;
    border-right: solid 1px black;
    box-sizing: border-box;
}

.automation-header {
    display: flex;
    width: 100%;
    flex-direction: column;
    padding: 5px;
    color: #cecece;
    font-family: Helvetica, sans-serif;
    font-size: 12px;
}

.automation-title {
    font-weight: bold;
    margin-bottom: 5px;
    padding-left: 10px;
}

.automation-controls {
    display: flex;
    flex-direction: row;
    align-items: center;
    padding-left: 10px;
}

.param-select {
    background-color: #333;
    color: white;
    border: 1px solid #555;
    padding: 2px 5px;
    border-radius: 4px;
    font-size: 11px;
    width: 120px;
}

.close-btn {
    cursor: pointer;
    margin-right: 10px;
}
.close-btn:hover {
    color: white;
}
</style>
<div class="automation-header">
    <div class="automation-title">Automation</div>
    <div class="automation-controls">
        <select class="param-select"></select>
    </div>
</div>
`

export default class AutomationTrackElement extends HTMLElement {

    private _paramSelect: HTMLSelectElement;

    constructor() {
        super();
        this.attachShadow({ mode: "open" });
        if (this.shadowRoot) {
            this.shadowRoot.appendChild(template.cloneNode(true));
            this._paramSelect = this.shadowRoot.querySelector(".param-select") as HTMLSelectElement;
        } else {
            throw new Error("Shadow root not found");
        }
    }

    connectedCallback() {
        console.log("AutomationTrackElement connected with height:", HEIGHT_AUTOMATION);
        this.style.height = `${HEIGHT_AUTOMATION}px`;
        this.style.minHeight = `${HEIGHT_AUTOMATION}px`;
        this.style.maxHeight = `${HEIGHT_AUTOMATION}px`;
        this.style.overflow = "hidden";
        this.style.flexShrink = "0";
        this.style.margin = "0";
        this.style.boxSizing = "border-box";
    }

    public setParameters(params: { id: string, label: string }[], currentId: string) {
        this._paramSelect.innerHTML = "";
        params.forEach(p => {
            const option = document.createElement("option");
            option.value = p.id;
            option.text = p.label;
            option.selected = p.id === currentId;
            this._paramSelect.appendChild(option);
        });
    }

    public set onChange(callback: (id: string) => void) {
        this._paramSelect.onchange = (e) => {
            const target = e.target as HTMLSelectElement;
            callback(target.value);
        }
    }
}

customElements.define("automation-track-element", AutomationTrackElement);
