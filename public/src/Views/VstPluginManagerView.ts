import DraggableWindow from "../Utils/DraggableWindow";

export default class VstPluginManagerView extends DraggableWindow {

    closeBtn = document.getElementById("vst-plugin-manager-close-button") as HTMLButtonElement;
    window = document.getElementById("vst-plugin-manager-window") as HTMLDivElement;
    override header = document.getElementById("vst-plugin-manager-header") as HTMLDivElement;

    pathsListContainer = document.getElementById("vst-paths-list") as HTMLDivElement;
    addPathBtn = document.getElementById("vst-add-path-btn") as HTMLButtonElement;
    resetPathsBtn = document.getElementById("vst-reset-paths-btn") as HTMLButtonElement;
    autoScanSelect = document.getElementById("vst-auto-scan-select") as HTMLSelectElement;
    scanExecuteBtn = document.getElementById("vst-scan-execute-btn") as HTMLButtonElement;

    constructor() {
        super(document.getElementById("vst-plugin-manager-header") as HTMLDivElement, document.getElementById("vst-plugin-manager-window") as HTMLDivElement);
    }

    public show() {
        this.window.hidden = false;
    }

    public hide() {
        this.window.hidden = true;
    }
}
