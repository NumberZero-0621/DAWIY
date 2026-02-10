import { default as MetronomeComponent } from "../Components/MetronomeComponent";
import TempoElement from "../Components/TempoElement";
import TimeSignatureElement from "../Components/TimeSignatureElement";
import AudioLoopBrowser from "../Components/WamAudioLoopBrowser";
import AiAssistantSidebar from "../Components/AiAssistantSidebar";
import { RATIO_MILLS_BY_PX } from "../Env";
import { t } from "../Utils/i18n";

/**
 * Class responsible for the host view. It displays the host controls and the host track.
 */
export default class HostView {
    playBtn = document.getElementById("play-btn") as HTMLDivElement;
    backBtn = document.getElementById("back-btn") as HTMLDivElement;
    recordBtn = document.getElementById("record-btn") as HTMLDivElement;
    loopBtn = document.getElementById("loop-btn") as HTMLDivElement;
    muteBtn = document.getElementById("mute-btn") as HTMLDivElement;
    snapBtn = document.getElementById("snap-btn") as HTMLDivElement;
    splitBtn = document.getElementById("split-btn") as HTMLDivElement;
    mergeBtn = document.getElementById("merge-btn") as HTMLDivElement;
    undoBtn = document.getElementById("undo-btn") as HTMLDivElement;
    redoBtn = document.getElementById("redo-btn") as HTMLDivElement;
    metroBtn = document.getElementById("metro-btn") as HTMLDivElement;
    soundLoopBtn = document.getElementById("soundLoupBtn") as HTMLElement;
    aiAssistantBtn = document.getElementById("aiAssistantBtn") as HTMLElement;

    toolBtn = document.getElementById("tool-btn") as HTMLDivElement;
    toolMenu = document.getElementById("tool-menu") as HTMLDivElement;
    toolSelectBtn = document.getElementById("tool-select") as HTMLAnchorElement;
    toolPenBtn = document.getElementById("tool-pen") as HTMLAnchorElement;
    toolIcon = document.getElementById("tool-icon") as HTMLElement;

    timer = document.getElementById("timer") as HTMLDivElement;

    tempoDiv = document.getElementById("tempo-selector") as HTMLDivElement;
    tempoSelector = new TempoElement()

    audioLoopBrowserDiv = document.getElementById("audio-loop-browser") as HTMLDivElement;
    audioLoopBrowserElement = new AudioLoopBrowser() as HTMLElement;

    aiAssistantBrowserDiv = document.getElementById("ai-assistant-browser") as HTMLDivElement;
    aiAssistantElement = new AiAssistantSidebar() as HTMLElement;

    timeSignatureDiv = document.getElementById("time-signature-selector") as HTMLDivElement;
    timeSignatureSelector = new TimeSignatureElement()

    metronomeContainer = document.getElementById("metronome") as HTMLDivElement;
    metronomeArrow = document.getElementById("metro-btn-arrow");
    metronome = new MetronomeComponent();

    zoomInBtn = document.getElementById("zoom-in-btn") as HTMLDivElement;
    zoomOutBtn = document.getElementById("zoom-out-btn") as HTMLDivElement;

    playIcon = document.getElementById("play-icon") as HTMLDivElement;
    muteIcon = document.getElementById("mute-icon") as HTMLDivElement;
    snapIcon = document.getElementById("snap-icon") as HTMLDivElement;
    snapWrapper = document.getElementById("snap-wrapper") as HTMLDivElement;
    snapBtnArrow = document.getElementById("snap-btn-arrow") as HTMLButtonElement;
    snapMenu = document.getElementById("snap-menu") as HTMLDivElement;
    snap1_1 = document.getElementById("snap-1-1") as HTMLElement;
    snap1_2 = document.getElementById("snap-1-2") as HTMLElement;
    snap1_4 = document.getElementById("snap-1-4") as HTMLElement;
    snap1_8 = document.getElementById("snap-1-8") as HTMLElement;
    snap1_16 = document.getElementById("snap-1-16") as HTMLElement;
    snap1_32 = document.getElementById("snap-1-32") as HTMLElement;
    snapTriplet = document.getElementById("snap-triplet") as HTMLElement;
    snapTripletCheck = document.getElementById("snap-triplet-check") as HTMLElement;
    undoIcon = document.getElementById("undo-icon") as HTMLDivElement;
    redoIcon = document.getElementById("redo-icon") as HTMLDivElement;
    metronomeIcon = document.getElementById("metro-icon") as HTMLDivElement;

    songsContainer = document.getElementById("songs-container") as HTMLDivElement;

    // Menu buttons
    importSongs = document.getElementById("import-songs") as HTMLInputElement
    importMidi = document.getElementById("import-midi-btn") as HTMLInputElement
    newTrackInput: HTMLInputElement = document.getElementById("new-track-input") as HTMLInputElement
    newMidiTrackInput: HTMLInputElement = document.getElementById("new-midi-track-input") as HTMLInputElement

    settingsBtn = document.getElementById("settings-btn") as HTMLDivElement
    dawiyPluginBtn = document.getElementById("dawiy-plugin-btn") as HTMLDivElement
    wamPluginBtn = document.getElementById("wam-plugin-btn") as HTMLDivElement
    vstScanBtn = document.getElementById("vst-scan-btn") as HTMLDivElement
    saveBtn = document.getElementById("save-project") as HTMLDivElement
    saveDawProjectBtn = document.getElementById("save-dawproject") as HTMLDivElement

    // Bottom Panel DAWIY Elements
    dawiyExtensionsContainer = document.getElementById("dawiy-extensions-container") as HTMLDivElement;
    dawiyExtensionList = document.getElementById("dawiy-extension-list") as HTMLDivElement;
    dawiyExtensionView = document.getElementById("dawiy-extension-view") as HTMLDivElement;

    loadBtn = document.getElementById("load-project") as HTMLDivElement
    loadDawProjectBtn = document.getElementById("load-dawproject") as HTMLDivElement
    dawprojectInput = document.getElementById("dawproject-input") as HTMLInputElement
    exportProject = document.getElementById("export-project") as HTMLInputElement
    exportMidi = document.getElementById("export-midi") as HTMLInputElement

    aboutBtn = document.getElementById("about-btn") as HTMLDivElement
    aboutCloseBtn = document.getElementById("about-close-button") as HTMLDivElement
    aboutWindow = document.getElementById("about-window") as HTMLDivElement


    keyboardShortcutsCloseBtn = document.getElementById("keyboard-shortcuts-close-button") as HTMLDivElement;
    keyboardShortcutsWindow = document.getElementById("keyboard-shortcuts-window") as HTMLDivElement;

    host = document.getElementById("main-track") as HTMLDivElement;

    toggleButtonsDiv = document.getElementById("ToggleButtons") as HTMLDivElement;

    // Export menu container (dynamically found or add ID in template if needed)
    // For now we look for the dropdown inside menu-container-export-project
    exportMenuDropdown = document.querySelector("#menu-container-export-project .dropdown-menu") as HTMLDivElement;

    constructor() {
        // add tempo and time signature selectors to the main toolbar
        this.tempoDiv.appendChild(this.tempoSelector);
        this.timeSignatureDiv.appendChild(this.timeSignatureSelector);

        // audio loop browser
        this.audioLoopBrowserDiv.appendChild(this.audioLoopBrowserElement);

        // ai assistant browser
        this.aiAssistantBrowserDiv.appendChild(this.aiAssistantElement);

        this.metronomeContainer.appendChild(this.metronome);
    }

    /**
     * Adds a new menu item to the Export menu.
     * @param label Label of the menu item
     * @param callback Function to call when clicked
     */
    public addExportMenuItem(label: string, callback: () => void) {
        if (!this.exportMenuDropdown) {
            console.warn("Export menu dropdown not found.");
            return;
        }
        const item = document.createElement("a");
        item.className = "dropdown-item";
        item.innerText = label;
        item.style.cursor = "pointer";
        item.addEventListener("click", callback);
        this.exportMenuDropdown.appendChild(item);
    }


    /**
     * Adds a new sidebar item from a plugin.
     * @param id Unique ID for the sidebar item
     * @param icon Bootstrap icon class (e.g., "bi-plugin")
     * @param label Tooltip label
     * @param element The content element to show in the sidebar
     */
    public addSidebarItem(id: string, icon: string, label: string, element: HTMLElement) {
        // 1. Create the toggle button
        const btn = document.createElement("button");
        btn.id = `sidebar-btn-${id}`;
        btn.innerHTML = `<i class="bi ${icon}"></i>`;
        btn.title = label; // Simple tooltip

        // Add to ToggleButtons container
        this.toggleButtonsDiv.appendChild(btn);

        // 2. Create the content container (sidebar pane)
        const paneId = `sidebar-pane-${id}`;
        const pane = document.createElement("div");
        pane.id = paneId;
        pane.style.display = "none";
        // Styling to match existing sidebars (absolute positioned, right side)
        // We might need to copy styles from #audio-loop-browser in CSS, 
        // but for now let's assume it shares a class or we apply similar styles.
        // Looking at style.css would be ideal, but we'll try to mimic the structure.
        // Actually, existing sidebars seem to be direct children of body or #app?
        // AppTemplate.html shows them at root level: <div id="audio-loop-browser"></div>
        pane.className = "sidebar-pane"; // We might need to add this class or style it manually
        // Copy basic styles from what we know about audio-loop-browser if it doesn't have a shared class
        pane.style.position = "absolute";
        pane.style.top = "50px"; // Height of menu bar?
        pane.style.right = "50px"; // Width of toggle bar?
        pane.style.bottom = "0";
        pane.style.width = "300px"; // Default width
        pane.style.backgroundColor = "#222";
        pane.style.borderLeft = "1px solid #444";
        pane.style.zIndex = "99";

        pane.appendChild(element);
        document.body.appendChild(pane); // Append to body to be safe, or #app

        // 3. Add toggle logic
        btn.addEventListener("click", () => {
            const isVisible = pane.style.display !== "none";

            // Close others
            this.closeAllSidebars();

            if (!isVisible) {
                pane.style.display = "flex"; // Or block
                btn.classList.add("active");
            }
        });

        // Track this sidebar (optional, if we want to manage them)
    }

    private closeAllSidebars() {
        // Close core sidebars
        this.audioLoopBrowserDiv.style.display = "none";
        this.aiAssistantBrowserDiv.style.display = "none";

        // Close custom sidebars (naively find by class or ID pattern)
        document.querySelectorAll('[id^="sidebar-pane-"]').forEach(el => {
            (el as HTMLElement).style.display = "none";
        });

        // Reset active buttons
        this.toggleButtonsDiv.querySelectorAll("button").forEach(b => b.classList.remove("active"));
    }

    toggleAudioLoopBrowser = this.soundLoopBtn.addEventListener("click", () => {
        const wasOpen = this.audioLoopBrowserDiv.style.display === "flex";
        this.closeAllSidebars();

        if (!wasOpen) {
            this.audioLoopBrowserDiv.style.display = "flex";
        }
    });

    toggleAiAssistantBrowser = this.aiAssistantBtn.addEventListener("click", () => {
        const wasOpen = this.aiAssistantBrowserDiv.style.display === "flex";
        this.closeAllSidebars();

        if (!wasOpen) {
            this.aiAssistantBrowserDiv.style.display = "flex";
        }
    });


    public updateMetronomeBtn(metronomeOn: boolean) {
        let tooltip = this.metroBtn.firstElementChild as HTMLSpanElement;
        if (metronomeOn) {
            this.metroBtn.style.backgroundColor = "black";
            tooltip.textContent = t("tooltip.metronome_on");
        }
        else {
            this.metroBtn.style.backgroundColor = "";
            tooltip.textContent = t("tooltip.metronome_off");
        }
    }

    public updateToolIcon(mode: "SELECT" | "PEN") {
        if (mode === "SELECT") {
            this.toolIcon.className = "bi bi-cursor-fill";
        } else {
            this.toolIcon.className = "bi bi-pencil-fill";
        }
    }

    /**
     * Updates the timer of the host view.
     *
     * @param pos - The current time in milliseconds
     */
    public updateTimer(pos: number) {
        this.timer.innerHTML = HostView.millisToMinutesAndSeconds(pos);
    }

    /**
     * Updates the timer of the host view from the x position of the playhead.
     *
     * @param pos - The position of the playhead in pixels.
     */
    public updateTimerByPixelsPos(pos: number) {
        // turn the pos from pixels to ms
        const posInMs = pos * RATIO_MILLS_BY_PX;
        this.timer.innerHTML = HostView.millisToMinutesAndSeconds(posInMs);
    }

    /**
     * Changes the icon of the play button when the user press it.
     *
     * @param playing - true if it is playing, false otherwise.
     * @param recording - true if it is recording
     */
    public updatePlayButton(playing: boolean, recording: boolean) {
        let tooltip = this.playBtn.firstElementChild as HTMLSpanElement;

        if (playing) {
            if (recording) {
                this.playIcon.className = "stop-icon";
                tooltip.innerHTML = t("tooltip.stop");
            } else {
                this.playIcon.className = "pause-icon";
                tooltip.innerHTML = t("tooltip.pause");
            }
        } else {
            this.playIcon.className = "play-icon";
            tooltip.innerHTML = t("tooltip.play");
        }
    }

    /**
     * Changes the icon of the loop button when the user press it.
     *
     * @param looping - true if the track is looping, false otherwise.
     */
    public updateLoopButton(looping: boolean) {
        let tooltip = this.loopBtn.firstElementChild as HTMLSpanElement;

        if (looping) {
            this.loopBtn.style.background = "black";
            tooltip.innerHTML = t("tooltip.turn_off_loop");
        }
        else {
            this.loopBtn.style.background = "";
            tooltip.innerHTML = t("tooltip.loop");
        }
    }

    /**
     * Changes the icon of the record button when the user press it.
     *
     * @param recording - true if the track is recording, false otherwise.
     */
    public updateRecordButton(recording: boolean) {
        let tooltip = this.recordBtn.firstElementChild as HTMLSpanElement;

        if (recording) {
            this.recordBtn.style.background = "black";
            tooltip.innerHTML = t("tooltip.stop_recording");
        }
        else {
            this.recordBtn.style.background = "";
            tooltip.innerHTML = t("tooltip.record");
        }
    }

    /**
     * Changes the icon of the mute button when the user press it.
     *
     * @param muted - true if the track is muted, false otherwise.
     */
    public updateMuteButton(muted: boolean): void {
        let tooltip = this.muteBtn.firstElementChild as HTMLSpanElement;

        if (muted) {
            this.muteIcon.className = "volume-off-icon";
            tooltip.innerHTML = t("tooltip.unmute");
        } else {
            this.muteIcon.className = "volume-up-icon";
            tooltip.innerHTML = t("tooltip.mute");
        }
    }
    public updateSnapButton(snapGrid: boolean): void {
        let tooltip = this.snapBtn.firstElementChild as HTMLSpanElement;

        if (snapGrid) {
            this.snapIcon.className = "snap-icon";
            tooltip.innerHTML = t("tooltip.snap_grid_off");
        } else {
            this.snapIcon.className = "snap-icon-off";
            tooltip.innerHTML = t("tooltip.snap_grid_on");
        }
    }

    public updateSnapMenu(denominator: number, triplet: boolean) {
        // Clear all checks
        [this.snap1_1, this.snap1_2, this.snap1_4, this.snap1_8, this.snap1_16, this.snap1_32].forEach(el => {
            const span = el.querySelector('span');
            if (span) span.remove();
        });

        // Check active
        let activeEl;
        switch (denominator) {
            case 1: activeEl = this.snap1_1; break;
            case 2: activeEl = this.snap1_2; break;
            case 4: activeEl = this.snap1_4; break;
            case 8: activeEl = this.snap1_8; break;
            case 16: activeEl = this.snap1_16; break;
            case 32: activeEl = this.snap1_32; break;
        }
        if (activeEl) {
            activeEl.innerHTML += ' <span style="float:right">✓</span>';
        }

        this.snapTripletCheck.style.display = triplet ? "block" : "none";
    }

    public setUndoButtonState(undoAvailable: boolean): void {
        if (undoAvailable)
            this.undoIcon.className = "undo-icon";
        else
            this.undoIcon.className = "undo-icon-off";
    }

    public setRedoButtonState(redoAvailable: boolean): void {
        if (redoAvailable)
            this.redoIcon.className = "redo-icon";
        else
            this.redoIcon.className = "redo-icon-off";
    }


    /**
     * Creates a new song item in the songs' container. It is used to display the songs in the dropdown menu.
     *
     * @param name - The name of the song.
     */
    public createNewSongItem(name: string): HTMLAnchorElement {
        let item = document.createElement("a");
        item.classList.add("dropdown-item");
        item.innerHTML = name;
        this.songsContainer.appendChild(item);
        return item;
    }

    /**
     * Converts milliseconds to minutes and seconds.
     *
     * @param millis - The milliseconds to convert.
     */
    private static millisToMinutesAndSeconds(millis: number) {
        const d = new Date(Date.UTC(0, 0, 0, 0, 0, 0, millis)),
            parts = [
                d.getUTCHours(),
                d.getUTCMinutes(),
                d.getUTCSeconds()
            ];
        return parts.map(s => String(s).padStart(2, '0')).join(':') + "." + String(d.getMilliseconds()).padStart(3, '0');
    }
}
