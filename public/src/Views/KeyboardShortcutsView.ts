import DraggableWindow from "../Utils/DraggableWindow";

/**
 * View for the about window. It contains all the elements of the about window.
 */
export default class KeyboarsShortcutsWindow extends DraggableWindow {

    listContainer = document.getElementById("keyboard-shortcuts-list") as HTMLDivElement;
    resetBtn = document.getElementById("keyboard-shortcuts-reset-btn") as HTMLButtonElement;
    closeBtn = document.getElementById("keyboard-shortcuts-close-button") as HTMLButtonElement;
    errorDiv = document.getElementById("keyboard-shortcuts-error") as HTMLDivElement;

    constructor() {
        super(document.getElementById("keyboard-shortcuts-header") as HTMLDivElement, document.getElementById("keyboard-shortcuts-window") as HTMLDivElement);
        this.closeBtn.onclick = () => this.closeWindow();
    }

    openWindow() {
        this.resizableWindow.hidden = false;
    }

    closeWindow() {
        this.resizableWindow.hidden = true;
    }

}