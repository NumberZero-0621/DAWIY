import App from "../../App";
import { DAWIYPlugin } from "../IDawiyPlugin";
import DawiyPluginBase from "../DawiyPluginBase";
import HostAPI from "../API/HostAPI";
import Track from "../../Models/Track/Track";
import MIDIRegion from "../../Models/Region/MIDIRegion";
import { MIDI, MIDINote } from "../../Audio/MIDI/MIDI";
import { RATIO_MILLS_BY_PX, TEMPO } from "../../Env";

@DAWIYPlugin
export default class MelodyCreatorPlugin extends DawiyPluginBase {
    id = "melody-creator-plugin";
    name = "Melody Creator";
    description = "Adds a simple 'Do-Re-Mi' sequence to a new track within a MIDI clip.";
    author = "AI Assistant";
    version = "1.0.1"; // Incrementing version due to fix and UI change

    constructor(app: App) {
        super(app);
    }

    /**
     * Called when plugin is loaded. Used for initialization, no sidebar item registered here now.
     */
    public override onInit(host: HostAPI) {
        // Just show a toast for initialization, the button is in render() now.
        host.ui.showToast("Melody Creator Plugin initialized!");
    }

    /**
     * Renders the main plugin view. This is where the button will be.
     */
    public override render(container: HTMLElement) {
        container.className = "p-3"; // Add some padding to the plugin's main view

        container.innerHTML = `
            <h3>Melody Creator</h3>
            <p>Click the button below to add a new MIDI track with a simple C4-D4-E4 quarter-note melody starting from beat 0.</p>
        `;

        const createMelodyButton = document.createElement("button");
        createMelodyButton.className = "btn btn-primary w-100 mt-3"; // Bootstrap styling for full width button with margin-top
        createMelodyButton.textContent = "Add Do-Re-Mi Track";
        createMelodyButton.onclick = () => this.createDoReMiMelody();

        container.appendChild(createMelodyButton);
    }

    async createDoReMiMelody() {
        try {
            // 1. Create a new track
            const newTrack: Track = await this.app.tracksController.createTrack("Do-Re-Mi Track");

            if (!newTrack) {
                this.app.hostAPI.ui.showToast("Failed to create new track.", true);
                return;
            }

            // Define notes: C4 (MIDI 60), D4 (MIDI 62), E4 (MIDI 64)
            const notes = [
                { pitch: 60, name: "C4" },
                { pitch: 62, name: "D4" },
                { pitch: 64, name: "E4" },
            ];

            const beatMs = (60 / TEMPO) * 1000;
            const durationMs = 3 * beatMs; // 3 quarter notes

            // 2. Create a new MIDI object
            const midi = new MIDI(500, durationMs);
            const velocity = 100;

            // 3. Add notes sequentially to the MIDI object
            for (let i = 0; i < notes.length; i++) {
                const note = notes[i];
                const startTimeMs = i * beatMs;
                const noteDurationMs = beatMs;

                midi.putNote(new MIDINote(note.pitch, velocity, 0, noteDurationMs), startTimeMs);
            }

            // 4. Create MIDI region and add it to the track
            const startMs = 0;
            const newRegion = new MIDIRegion(midi, startMs);

            this.app.regionsController.addRegion(newTrack, newRegion);

            // Optional: Select the new track
            this.app.tracksController.select(newTrack);

            this.app.hostAPI.ui.showToast(`'Do-Re-Mi' melody added to "${newTrack.element.name}"!`);

        } catch (error: any) {
            this.app.hostAPI.ui.showToast(`Error creating melody: ${error.message}`, true);
            console.error("Error creating melody:", error);
        }
    }

    public override onDeactivate() {
        // No specific cleanup needed for this simple plugin
    }
}