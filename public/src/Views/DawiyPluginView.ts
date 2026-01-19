import DraggableWindow from "../Utils/DraggableWindow";

export default class DawiyPluginView extends DraggableWindow {

    closeBtn = document.getElementById("dawiy-plugin-close-button") as HTMLButtonElement;
    window = document.getElementById("dawiy-plugin-window") as HTMLDivElement;
    override header = document.getElementById("dawiy-plugin-header") as HTMLDivElement;

    filterAllBtn = document.getElementById("pm-filter-all") as HTMLButtonElement;
    filterInstalledBtn = document.getElementById("pm-filter-installed") as HTMLButtonElement;
    filterNotInstalledBtn = document.getElementById("pm-filter-not-installed") as HTMLButtonElement;

    listContainer = document.getElementById("pm-list") as HTMLDivElement;

    addManualBtn = document.getElementById("pm-add-manual-btn") as HTMLButtonElement;
    addManualInput = document.getElementById("pm-add-manual-input") as HTMLInputElement;

    // Creator UI
    filterCreatorBtn = document.getElementById("pm-filter-creator") as HTMLButtonElement;
    creatorContainer = document.getElementById("pm-creator") as HTMLDivElement;
    creatorDropZone = document.getElementById("pm-creator-dropzone") as HTMLDivElement;

    creatorNameInput = document.getElementById("pm-creator-name") as HTMLInputElement;
    creatorClassInput = document.getElementById("pm-creator-classname") as HTMLInputElement;
    creatorDescInput = document.getElementById("pm-creator-desc") as HTMLInputElement;
    creatorGroupInput = document.getElementById("pm-creator-group") as HTMLInputElement;

    creatorGenerateBtn = document.getElementById("pm-creator-generate") as HTMLButtonElement;
    creatorCancelBtn = document.getElementById("pm-creator-cancel") as HTMLButtonElement;

    // Pop-out UI
    popOutBtn = document.getElementById("dawiy-popout-btn") as HTMLButtonElement;
    pluginTitle = document.getElementById("dawiy-extension-title") as HTMLSpanElement;

    constructor() {
        super(document.getElementById("dawiy-plugin-header") as HTMLDivElement, document.getElementById("dawiy-plugin-window") as HTMLDivElement);
    }

    public show() {
        this.window.hidden = false;
    }

    public hide() {
        this.window.hidden = true;
    }
}
