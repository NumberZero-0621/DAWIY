import App from "../App";
import { createSelect } from "../Utils/dom";
import SettingsView from "../Views/SettingsView";
import { audioCtx } from "../index";
import { CURRENT_LANGUAGE, setLanguage, Language, t } from "../Utils/i18n";

/**
 * The class that control the events related to the global settings of the host.
 */
export default class SettingsController {

    /** Called each time a MIDI Event is received. **/ // @ts-ignore 
    public on_midi_message = new Set<(message: MIDIMessageEvent) => void>()

    /** The selected microphone input node. */
    public soundInputNode: AudioNode = audioCtx.createGain()


    /** Settings view. */
    private view: SettingsView;

    /** The constraints for the media stream. */
    public constraints: MediaStreamConstraints | undefined;

    private app: App;

    constructor(app: App) {
        this.app = app;
        this.view = app.settingsView;

        this.initMIDIInputDevice()
        this.initAudioInputOutputDevice()
        this.initLanguageSelector()
        this.bindEvents()
    }



    //// MIDI INPUT DEVICE ////
    private initMIDIInputDevice() {
        const that = this

        // On midi message callback
        // @ts-ignore
        function onMidiMessage(e: MIDIMessageEvent) {
            if (e.data) {
                // Transform "NoteOn + Velocity 0" en "NoteOff" to maximize compatibility
                const type = e.data[0] >> 4
                const channel = e.data[0] & 0xf
                if (type == 0x9 && e.data[2] == 0) {
                    e.data[0] = 0x8 + channel
                }

                that.on_midi_message.forEach((callback) => callback(e))
            }
        }

        // @ts-ignore
        navigator.requestMIDIAccess?.()?.then((midiAccess) => {

            const refresh = function () {
                createSelect(
                    that.view.selectMIDIInputDevice,
                    "midiinput",
                    "No MIDI Input",
                    [...midiAccess.inputs.values()],
                    it => [it.name ?? "Unknown", it.id],
                    selected => {
                        if (that._selectedMIDIInputDevice != null) {
                            that._selectedMIDIInputDevice.removeEventListener("midimessage", onMidiMessage)
                            that._selectedMIDIInputDevice = null
                        }
                        if (selected != null) {
                            that._selectedMIDIInputDevice = selected
                            selected.addEventListener("midimessage", onMidiMessage)
                        }
                    },
                    -1
                )
            }
            midiAccess.onstatechange = refresh
            refresh()
        })
    }

    //@ts-ignore
    private _selectedMIDIInputDevice: MIDIInput | null = null;



    //// AUDIO INPUT AND OUTPUT DEVICE ////
    private async initAudioInputOutputDevice() {
        const that = this

        async function refresh() {
            await navigator.mediaDevices.getUserMedia({ audio: true });
            const devices = await navigator.mediaDevices.enumerateDevices();
            console.log(devices.map(it => it.kind + " " + it.groupId + " " + it.deviceId + " " + it.label + "\n"))

            // Input Device
            createSelect(
                that.view.selectInputDevice,
                "audioinput",
                "No Input Device",
                devices.filter(it => it.kind === "audioinput"),
                it => [it.label ?? "Unknown", it.deviceId],
                async device => {
                    if (that._selectedInputDevice != null) {
                        that._selectedInputDevice.disconnect(that.soundInputNode)
                        that._selectedInputDevice = null
                    }
                    if (device != undefined) {
                        const constraints = { audio: { deviceId: { exact: device.deviceId }, echoCancellation: false, noiseSuppression: false, autoGainControl: false } }
                        that.constraints = constraints
                        let stream = await navigator.mediaDevices.getUserMedia(constraints)
                        that._selectedInputDevice = audioCtx.createMediaStreamSource(stream)
                        that._selectedInputDevice.connect(that.soundInputNode)
                    }
                },
                -1
            )

            // Output Device
            // @ts-ignore
            const baseSinkId = audioCtx.sinkId

            createSelect(
                that.view.selectOutputDevice,
                "audiooutput",
                "Base Output Device",
                devices.filter(it => it.kind === "audiooutput"),
                it => [it.label ?? "Unknown", it.deviceId],
                async device => {
                    try {
                        // @ts-ignore
                        if (audioCtx.setSinkId) await audioCtx.setSinkId(device != null ? device.deviceId : baseSinkId);
                    } catch (e) {
                        console.log("Error with setSinkId: " + e)
                    }
                },
                -1
            )

            console.log("devices: " + devices.filter(it => it.kind === "audioinput").map(it => it.kind + " " + it.groupId + " " + it.deviceId + " " + it.label + "\n"))

            console.log("devices: " + devices.map(it => it.kind + " " + it.groupId + " " + it.deviceId + " " + it.label + "\n"))

        }
        refresh()
        navigator.mediaDevices.addEventListener("devicechange", () => refresh())
    }

    private _selectedInputDevice: AudioNode | null = null;

    private initLanguageSelector() {
        this.view.selectLanguage.value = CURRENT_LANGUAGE;
        this.view.selectLanguage.onchange = () => {
            const newLang = this.view.selectLanguage.value as Language;
            setLanguage(newLang);
            this.app.aboutView.updateLanguage();
        };
    }

    /**
     * Opens the settings window. It also updates the list of input and output devices. 
     */
    public async openSettings(): Promise<void> {
        this.view.settingsWindow.hidden = false;
    }

    private bindEvents() {
        this.view.closeBtn.onclick = () => this.view.settingsWindow.hidden = true
        this.view.latencyBtn.onclick = () => {
            this.app.latencyView.openWindow();
            this.openChildWindow(this.app.latencyView);
        }
        this.view.loginBtn.onclick = () => {
            this.app.projectController.openLoginWindow();
            this.openChildWindow(this.app.projectView);
        }
        if (this.view.menuCustomizationBtn) {
            this.view.menuCustomizationBtn.onclick = () => {
                this.app.menuCustomizationView.openWindow();
                this.openChildWindow(this.app.menuCustomizationView);
            }
        }
        if (this.view.keyboardShortcutsBtn) {
            this.view.keyboardShortcutsBtn.onclick = () => {
                this.app.keyboardShortcutsView.openWindow();
                this.app.shortcutController.refreshUI();
                this.openChildWindow(this.app.keyboardShortcutsView);
            }
        }
    }

    /**
     * Opens a child window positioned relative to the settings window.
     * Checks other potential child windows to apply an offset if they are already open.
     */
    private openChildWindow(windowToOpen: any) {
        // "any" type used temporarily because different views have slight differences in properties if not unified by interface,
        // but DraggableWindow usually has resizableWindow.
        // Let's assume passed object has resizableWindow (DraggableWindow).

        const settingsRect = this.view.settingsWindow.getBoundingClientRect();
        const targetRect = windowToOpen.resizableWindow.getBoundingClientRect();

        // Base Target Position (Right of Settings)
        let targetX = settingsRect.right + 20;
        let targetY = settingsRect.top;

        // Check for other visible windows to apply offset
        let offsetCount = 0;

        // List of windows that might be open and taking up space
        const potentialWindows = [
            this.app.latencyView,
            this.app.latencyView,
            this.app.keyboardShortcutsView,
            this.app.projectView,
            this.app.menuCustomizationView
        ];

        for (const otherWindow of potentialWindows) {
            // If it's not the window we are trying to open, and it is visible
            if (otherWindow !== windowToOpen && !otherWindow.resizableWindow.hidden) {
                // Check if it is roughly in the "child window zone"
                // Simple check: is it visible?
                offsetCount++;
            }
        }

        // Apply Logic:
        // 0 other windows -> No offset
        // 1 other window -> Offset 1 step
        // 2 other windows -> Offset 2 steps
        const OFFSET_X = 30;
        const OFFSET_Y = 30;

        targetX += (offsetCount * OFFSET_X);
        targetY += (offsetCount * OFFSET_Y);

        const deltaX = targetX - targetRect.left;
        const deltaY = targetY - targetRect.top;

        windowToOpen.setPosition(
            windowToOpen.xOffset + deltaX,
            windowToOpen.yOffset + deltaY
        );

        // Bring to front
        this.app.hostController.focus(windowToOpen);
    }


    public updateLoginStatus(isLoggedIn: boolean) {
        this.view.loginBtn.innerText = isLoggedIn ? t("menu.logout") : t("settings.login");
    }
}