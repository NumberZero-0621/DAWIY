import App from "../App";
import { doc } from "../Utils/dom";

const template = doc/*html*/`
  <style>
    :host {
      width: 100%;
      height: 52px;
      padding: 1px;
      display: flex;
      flex-direction: column;
      font-family: Roboto;
      overflow: hidden;
      z-index: 1;
      position: relative;
      -webkit-font-smoothing: antialiased;  
      padding-right: 10px;
      border-right: solid 1px rgb(111, 111, 111);
      background-color:transparent;
    }
    .tempo-section {
      border-color: rgba(255,255,255,0.05);
      display: flex;
      align-items: center;
    }
    #input {
      color: lightgrey;
      display: inline-block;
      border: none;
      background-color: transparent;
      padding: 0;
      border-radius: 0;
      font-family: "Unica One";
      font-size: 28px;
      height: 52px;
      line-height: 52px;
      width: 90px;
      text-align: right;
      margin-left:-5px;
      &:focus {
        outline: none;
        border: none;
        font-style: italic;
      }
      &:hover{
        font-weight: bold;
      }
    #input:invalid {
        color:red;
      }
    }
  </style>

    <style>
        #automation.control {
            opacity: 0.4;
            transition: all 0.2s ease;
        }
        #automation.control:hover {
            filter: invert(27%) sepia(51%) saturate(2878%) hue-rotate(346deg) brightness(104%) contrast(97%);
        }
        #automation.control._toggled {
            opacity: 1.0;
            filter: contrast(0) brightness(2);
        }
    </style>
  <div class="tempo-section">
    <link rel="stylesheet" href="style/icons.css">
    <input id="input" value="120.00" pattern="[0-9]+(\\.[0-9]{0,2})?" maxlength=6> 
    <div id="automation" class="control" style="padding-top: 10px; margin-left: 5px; cursor: pointer;">
        <i class="icon automation-icon" style="width: 15px;"></i>
    </div>
  </div>
`;

export default class TempoElement extends HTMLElement {
  private _app: App;
  set app(app: App) { this._app = app; }

  constructor() {
    super();
    this.attachShadow({ mode: "open" });
  }

  connectedCallback() {
    if (this.shadowRoot !== null) {
      this.shadowRoot.replaceChildren(template.cloneNode(true));
      this.defineListeners();
    }
  }

  get input() { return this.shadowRoot!.querySelector("#input") as HTMLInputElement }
  get automationBtn() { return this.shadowRoot!.querySelector("#automation") as HTMLElement }

  /** The tempo in BPM(beat per minute) */
  get tempo(): number { return parseFloat(this.input.value) }

  set tempo(newTempo: number) {
    this.input.value = Math.max(1, newTempo ?? 120).toFixed(2);
    this.on_change.forEach((callback) => callback(this.tempo));
  }

  defineListeners() {
    this.input.addEventListener("change", () => this.on_change.forEach(callback => callback(this.tempo)));
    this.input.addEventListener("keydown", (e) => {
      if (e.key === "ArrowUp") {
        this.tempo = this.tempo + 1;
        e.preventDefault();
      } else if (e.key === "ArrowDown") {
        this.tempo = this.tempo - 1;
        e.preventDefault();
      }
    });

    this.automationBtn.addEventListener("click", () => {
      const active = this.automationBtn.classList.toggle("_toggled");
      if (this._app) {
        this._app.automationController.toggleBpmAutomation(active);
      }
    });
  }

  readonly on_change = new Set<(newTempo: number) => void>()
}


customElements.define("wamstudio-tempo-selector", TempoElement);