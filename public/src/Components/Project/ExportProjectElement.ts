import SoundProvider from "../../Models/Track/SoundProvider";

const template = document.createElement('template');

template.innerHTML = `

<style>

#main {
    display: flex;
    flex-direction: column;
    flex-wrap: nowrap;
    align-items: center;
    justify-content: center;
    color: lightgrey;
    margin: 10px;
}

.form-element {
    width: 100%;
    display: flex;
    flex-direction: row;
    flex-wrap: nowrap;
    align-items: center;
    margin: 5px;
    gap: 5px;
}

#tracks-container {
    display: flex;
    flex-direction: column;
    flex-wrap: nowrap;
    gap: 5px;
    min-width: 305px;
    min-height: 160px;
    max-height: 200px;
    margin: 5px;
    padding-right: 10px;
    overflow-y: scroll;
    overflow-x: hidden;
    background-color: rgb(23, 23, 26);
}

p {
    margin: 5px;
}

progress {
    width: 100%;
    height: 20px;
    margin: 5px;
}

#progress-label {
    font-size: 0.8em;
    color: #ddd;
}

button {
    margin: 5px;
    border-radius: 4px;
    width: max-content;
    cursor: pointer;
    padding: 8px 16px;
    transition: background-color 0.2s;
}

button:hover {
    background-color: #555;
}

</style>

<div id="main">
    <p id="title">Export Project</p>
    <div class="form-element">
        <label for="name">Project Name</label>
        <input id="name-input" type="text" placeholder="Project Name..." name="name">
    </div>
    <div class="form-element">
        <label for="master">Master Track</label>
        <input type="checkbox" id="master-input" name="master" checked>
    </div>
    <div class="form-element">
        <label for="select-all">Select All</label>
        <input type="checkbox" id="select-all-input" name="select-all">
    </div>
    <div id="tracks-container">
    
    </div>
    <div class="form-element">
        <button id="export-btn">Export</button>
    </div>
    <progress id="export-progress" value="0" max="100" hidden></progress>
    <span id="progress-label" hidden></span>
</div>    
`

/**
 * The export project modal element.
 * It is used to export a project.
 * It contains a form to select the tracks to export and the name of the project.
 * It also contains a button to export the project.
 */
export default class ExportProjectElement extends HTMLElement {

    initialized: boolean = false;

    constructor() {
        super();
        this.attachShadow({ mode: "open" });
    }

    connectedCallback() {
        if (!this.initialized) {
            this.shadowRoot?.appendChild(template.content.cloneNode(true));
            this.bindEvents();
        }
    }

    private bindEvents() {
        const selectAllInput = this.selectAllInput;
        selectAllInput.addEventListener("change", () => {
            const checked = selectAllInput.checked;
            const checkboxes = this.tracksContainer.querySelectorAll("input[type='checkbox']") as NodeListOf<HTMLInputElement>;
            checkboxes.forEach(cb => cb.checked = checked);
        });
    }

    public showProgress(percent: number, message: string = "") {
        const progress = this.shadowRoot?.getElementById("export-progress") as HTMLProgressElement;
        const label = this.shadowRoot?.getElementById("progress-label") as HTMLElement;
        const btn = this.exportBtn;

        if (progress) {
            progress.hidden = false;
            progress.value = percent;
        }
        if (label) {
            label.hidden = false;
            label.innerText = message || `${Math.round(percent)}%`;
        }
        if (btn) {
            btn.disabled = true;
        }
    }

    public hideProgress() {
        const progress = this.shadowRoot?.getElementById("export-progress") as HTMLProgressElement;
        const label = this.shadowRoot?.getElementById("progress-label") as HTMLElement;
        const btn = this.exportBtn;

        if (progress) progress.hidden = true;
        if (label) label.hidden = true;
        if (btn) btn.disabled = false;
    }

    setTitle(title: string) {
        let titleElement = this.shadowRoot?.querySelector("#title") as HTMLElement;
        titleElement.innerText = `Export Project : ${title}`;
    }

    /**
     * Updates the list of tracks to export in the export project modal
     * It will remove all the previous tracks and add the new ones.
     * By default, all the tracks are selected.
     * @param tracks The list of tracks to export
     */
    update(tracks: SoundProvider[]) {
        if (this.tracksContainer.children.length > 0) {
            this.tracksContainer.innerHTML = "";
        }

        // Reset Select All
        this.selectAllInput.checked = false;

        for (let track of tracks) {
            let formElement = document.createElement("div");
            formElement.classList.add("form-element");

            let label = document.createElement("label");
            label.setAttribute("for", track.element.name);
            label.innerText = `Track : ${track.element.name}`;

            let checkbox = document.createElement("input");
            checkbox.setAttribute("type", "checkbox");
            checkbox.setAttribute("id", `input-${track.id}`);
            checkbox.setAttribute("name", track.element.name);
            // Default unchecked as requested
            // checkbox.setAttribute("checked", "true"); 

            checkbox.addEventListener("change", () => {
                this.updateSelectAllState();
            });

            formElement.appendChild(label);
            formElement.appendChild(checkbox);

            this.tracksContainer.appendChild(formElement);
        }
    }

    private updateSelectAllState() {
        const checkboxes = Array.from(this.tracksContainer.querySelectorAll("input[type='checkbox']")) as HTMLInputElement[];
        if (checkboxes.length === 0) {
            this.selectAllInput.checked = false;
            return;
        }
        const allChecked = checkboxes.every(cb => cb.checked);
        this.selectAllInput.checked = allChecked;
    }

    /**
     * Get if the master track is selected or not.
     *
     * @returns true if the master track is selected, false otherwise.
     */
    isMasterTrackSelected(): boolean {
        return this.masterInput.checked;
    }

    /**
     * Get the selected tracks ids.
     *
     * @returns an array of the selected tracks ids.
     */
    getSelectedTracks(): number[] {
        let selectedTracks: number[] = [];
        for (let child of this.tracksContainer.children) {
            let checkbox = child.getElementsByTagName("input")[0] as HTMLInputElement;
            if (checkbox.checked) {
                selectedTracks.push(parseInt(checkbox.id.split("-")[1]));
            }
        }
        return selectedTracks;
    }

    get nameInput(): HTMLInputElement {
        return this.shadowRoot?.getElementById("name-input") as HTMLInputElement;
    }

    get masterInput(): HTMLInputElement {
        return this.shadowRoot?.getElementById("master-input") as HTMLInputElement;
    }

    get selectAllInput(): HTMLInputElement {
        return this.shadowRoot?.getElementById("select-all-input") as HTMLInputElement;
    }

    get tracksContainer(): HTMLDivElement {
        return this.shadowRoot?.getElementById("tracks-container") as HTMLDivElement;
    }

    get exportBtn(): HTMLButtonElement {
        return this.shadowRoot?.getElementById("export-btn") as HTMLButtonElement;
    }
}