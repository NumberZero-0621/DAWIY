import { HEIGHT_AUTOMATION } from "../../Env";
import { doc } from "../../Utils/dom";
import { ParameterDefinition } from "../../Controllers/AutomationController";

const template = doc/*html*/`
<style>
:host {
    display: flex;
    width: 100%;
    flex-direction: row; /* 横並び */
    justify-content: flex-start;
    align-items: stretch;
    background: #1e1e1e;
    border-bottom: solid 1px #7b7b7b;
    border-left: solid 1px black;
    border-right: solid 1px black;
    box-sizing: border-box;
    user-select: none;
}

.main-content {
    display: flex;
    flex-direction: column;
    flex-grow: 1;
    justify-content: space-evenly;
    padding: 4px;
    height: 100%;
    overflow: hidden;
}

.automation-header {
    display: flex;
    width: 100%;
    flex-direction: column;
    color: #cecece;
    font-family: Helvetica, sans-serif;
    font-size: 12px;
}

.automation-title {
    font-weight: bold;
    padding-left: 2px;
    margin-bottom: 2px;
}

.automation-controls {
    display: flex;
    flex-direction: column;
    width: 100%;
    gap: 4px;
}

.param-selector {
    background-color: #333;
    color: white;
    border: 1px solid #555;
    padding: 2px 8px;
    border-radius: 4px;
    font-size: 11px;
    width: 100%;
    box-sizing: border-box;
    cursor: pointer;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    height: 20px;
    display: flex;
    align-items: center;
}

.param-selector:hover {
    background-color: #444;
}

.btn-container {
    display: flex;
    flex-direction: row;
    justify-content: center;
    gap: 10px;
    width: 100%;
}

.color-strip {
    width: 12px;
    height: 100%;
    background-color: #555;
    cursor: pointer;
    border-left: 1px solid #111;
    box-sizing: border-box;
}
.color-strip:hover {
    filter: brightness(1.2);
}
</style>
<div class="main-content">
    <div class="automation-header">
        <div class="automation-title">Automation</div>
        <div class="automation-controls">
            <div class="param-selector">Select Parameter</div>
            <div class="btn-container"></div>
        </div>
    </div>
</div>
<div class="color-strip"></div>
`

export default class AutomationTrackElement extends HTMLElement {

    private _paramSelector: HTMLDivElement;
    private _addBtn: HTMLDivElement;
    private _removeBtn: HTMLDivElement;
    private _btnContainer: HTMLDivElement;
    private _colorStrip: HTMLDivElement;

    public onAdd: (() => void) | null = null;
    public onRemove: (() => void) | null = null;
    public onColorClick: ((x: number, y: number) => void) | null = null;
    public onParamSelectClick: ((x: number, y: number) => void) | null = null;

    constructor() {
        super();
        this.attachShadow({ mode: "open" });
        if (this.shadowRoot) {
            this.shadowRoot.appendChild(template.cloneNode(true));
            this._paramSelector = this.shadowRoot.querySelector(".param-selector") as HTMLDivElement;
            this._colorStrip = this.shadowRoot.querySelector(".color-strip") as HTMLDivElement;

            this._colorStrip.addEventListener("click", (e) => {
                if (this.onColorClick) {
                    const rect = this._colorStrip.getBoundingClientRect();
                    this.onColorClick(rect.right + 5, rect.top);
                }
            });

            this._paramSelector.addEventListener("click", (e) => {
                if (this.onParamSelectClick) {
                    const rect = this._paramSelector.getBoundingClientRect();
                    this.onParamSelectClick(rect.left, rect.bottom);
                }
            });

            // UI作成
            this._btnContainer = this.shadowRoot.querySelector(".btn-container") as HTMLDivElement;


            // Add Button
            this._addBtn = document.createElement("div");
            this._addBtn.className = "icon _letter";
            this._addBtn.innerText = "+";
            this._addBtn.style.cursor = "pointer";
            this._addBtn.style.color = "#eee";
            this._addBtn.style.fontWeight = "bold";
            this._addBtn.style.fontSize = "24px";
            this._addBtn.style.padding = "0px 10px";
            this._addBtn.style.userSelect = "none";
            this._addBtn.style.backgroundColor = "#444";
            this._addBtn.style.borderRadius = "4px";
            this._addBtn.style.display = "flex";
            this._addBtn.style.alignItems = "center";
            this._addBtn.style.justifyContent = "center";
            this._addBtn.style.height = "24px";
            this._addBtn.style.width = "40px"; // 幅を指定
            this._addBtn.title = "Add Automation Lane";

            // Remove Button
            this._removeBtn = document.createElement("div");
            this._removeBtn.className = "icon _letter";
            this._removeBtn.innerText = "-";
            this._removeBtn.style.cursor = "pointer";
            this._removeBtn.style.color = "#eee";
            this._removeBtn.style.fontWeight = "bold";
            this._removeBtn.style.fontSize = "24px";
            this._removeBtn.style.padding = "0px 10px";
            this._removeBtn.style.userSelect = "none";
            this._removeBtn.style.backgroundColor = "#444";
            this._removeBtn.style.borderRadius = "4px";
            this._removeBtn.style.display = "flex";
            this._removeBtn.style.alignItems = "center";
            this._removeBtn.style.justifyContent = "center";
            this._removeBtn.style.height = "24px";
            this._removeBtn.style.width = "40px"; // 幅を指定
            this._removeBtn.title = "Remove Automation Lane";

            this._btnContainer.appendChild(this._addBtn);
            this._btnContainer.appendChild(this._removeBtn);

            this._addBtn.addEventListener("click", () => {
                if (this.onAdd && !this._addBtn.classList.contains("disabled")) this.onAdd();
            });

            this._removeBtn.addEventListener("click", () => {
                if (this.onRemove) this.onRemove();
            });

        } else {
            throw new Error("Shadow root not found");
        }
    }

    connectedCallback() {
        // console.log("AutomationTrackElement connected with height:", HEIGHT_AUTOMATION);
        this.style.height = `${HEIGHT_AUTOMATION}px`;
        this.style.minHeight = `${HEIGHT_AUTOMATION}px`;
        this.style.maxHeight = `${HEIGHT_AUTOMATION}px`;
        this.style.overflow = "hidden";
        this.style.flexShrink = "0";
        this.style.margin = "0";
        this.style.boxSizing = "border-box";
    }

    public setParameters(params: ParameterDefinition[], currentId: string) {
        const current = params.find(p => p.id === currentId);
        this._paramSelector.innerText = current ? current.label : "Select Parameter";
    }

    public setAddButtonEnabled(enabled: boolean) {
        if (enabled) {
            this._addBtn.classList.remove("disabled");
            this._addBtn.style.opacity = "1";
            this._addBtn.style.cursor = "pointer";
        } else {
            this._addBtn.classList.add("disabled");
            this._addBtn.style.opacity = "0.3";
            this._addBtn.style.cursor = "default";
        }
    }

    public setColor(color: string | null) {
        if (color) {
            this._colorStrip.style.backgroundColor = color;
        } else {
            this._colorStrip.style.backgroundColor = "#555";
        }
    }

    public setButtonsVisible(visible: boolean) {
        this._btnContainer.style.display = visible ? "flex" : "none";
    }
}


