import DraggableWindow from "../Utils/DraggableWindow";

export default class WamPluginView extends DraggableWindow {

    closeBtn = document.getElementById("wam-plugin-close-button") as HTMLButtonElement;
    window = document.getElementById("wam-plugin-window") as HTMLDivElement;
    override header = document.getElementById("wam-plugin-header") as HTMLDivElement;

    filterInstalledBtn = document.getElementById("wp-filter-installed") as HTMLButtonElement;
    filterAvailableBtn = document.getElementById("wp-filter-available") as HTMLButtonElement;

    listContainer = document.getElementById("wp-list") as HTMLDivElement;

    importUrlInput = document.getElementById("wp-import-url") as HTMLInputElement;
    importUrlBtn = document.getElementById("wp-import-btn") as HTMLButtonElement;

    constructor() {
        super(document.getElementById("wam-plugin-header") as HTMLDivElement, document.getElementById("wam-plugin-window") as HTMLDivElement);
    }

    public show() {
        this.window.hidden = false;
    }

    public hide() {
        this.window.hidden = true;
    }
}
