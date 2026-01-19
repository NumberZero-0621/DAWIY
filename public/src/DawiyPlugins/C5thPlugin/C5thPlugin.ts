import App from "../../App";
import { IDawiyPlugin, DAWIYPlugin } from "../IDawiyPlugin";
import { MIDINote } from "../../Audio/MIDI/MIDI";
import { Chord, Note } from "tonal";

@DAWIYPlugin
export default class C5thPlugin implements IDawiyPlugin {
    id = "c5th-number-zero";
    name = "Chord & Circle of Fifths";
    description = "Displays the chord of selected notes and the Circle of Fifths.";

    private app: App;
    private container: HTMLElement | null = null;
    private chordDisplay: HTMLElement | null = null;
    private updateInterval: any = null;

    constructor(app: App) {
        this.app = app;
    }

    public render(container: HTMLElement) {
        this.container = container;
        container.innerHTML = '';
        container.style.color = "#eee";
        container.style.padding = "10px";
        container.style.display = "flex";
        container.style.flexDirection = "column";
        container.style.alignItems = "center";
        container.style.gap = "15px";
        container.style.height = "100%";
        container.style.overflowY = "auto";

        const title = document.createElement("h3");
        title.textContent = this.name;
        title.style.margin = "0";
        title.style.fontSize = "16px";
        container.appendChild(title);

        // Chord Display
        this.chordDisplay = document.createElement("div");
        this.chordDisplay.style.fontSize = "32px";
        this.chordDisplay.style.fontWeight = "bold";
        this.chordDisplay.style.color = "#4CAF50";
        this.chordDisplay.style.minHeight = "40px";
        this.chordDisplay.textContent = "--";
        container.appendChild(this.chordDisplay);

        // Image
        const img = document.createElement("img");
        // We moved the image to 'static' so it is served at root.
        img.src = "c5th.png";
        img.style.width = "100%";
        img.style.maxWidth = "300px";
        img.style.borderRadius = "8px";
        img.style.border = "1px solid #444";
        container.appendChild(img);

        // Start listening
        this.startLoop();
    }

    public onActivate() {
        this.startLoop();
    }

    public onDeactivate() {
        this.stopLoop();
    }

    private startLoop() {
        if (this.updateInterval) clearInterval(this.updateInterval);
        this.updateInterval = setInterval(() => this.update(), 200);
    }

    private stopLoop() {
        if (this.updateInterval) {
            clearInterval(this.updateInterval);
            this.updateInterval = null;
        }
    }

    private update() {
        if (!this.chordDisplay) return;

        // Access the exposed selectedNotes from PianoRollController
        const pianoRoll = this.app.pianoRollController as any;

        let notes: MIDINote[] = [];
        if (pianoRoll && pianoRoll.selectedNotes) {
            notes = Array.from(pianoRoll.selectedNotes);
            // console.log("C5thPlugin: selectedNotes size:", notes.length);
        }

        if (notes.length === 0) {
            this.chordDisplay.textContent = "--";
            return;
        }

        // Detect Chord
        const chordName = this.detectChord(notes);
        this.chordDisplay.textContent = chordName;
    }

    private detectChord(notes: MIDINote[]): string {
        if (notes.length === 0) return "--";

        // Convert MIDI notes to note names for tonal
        // tonal expects names like "C4", "Db5", etc.
        // We can use Note.fromMidi(midiNumber) from tonal
        const uniqueNoteNumbers = Array.from(new Set(notes.map(n => n.note)));
        const noteNames = uniqueNoteNumbers.map(n => Note.fromMidi(n));

        // Detect chord
        const detected = Chord.detect(noteNames);

        if (detected.length > 0) {
            // Return the first detected chord name
            return detected[0];
        }

        // Additional detected for omit3
        // Try adding a 3rd (minor: +3, major: +4) to each note and see if it forms a valid chord
        for (const noteNum of uniqueNoteNumbers) {
            for (const interval of [3, 4]) {
                const candidateNoteNum = noteNum + interval;
                // Avoid if candidate is already in the set (though uniqueNoteNumbers handles this, we are adding new pitches)
                // Actually if it's already there, it wouldn't have failed detection if it was a valid chord unless it's complex.
                // But simplified: checking if we already have it is good.
                if (uniqueNoteNumbers.includes(candidateNoteNum)) continue;

                const candidateNoteName = Note.fromMidi(candidateNoteNum);
                const combinedNames = [...noteNames, candidateNoteName];
                const combinedDetected = Chord.detect(combinedNames);

                if (combinedDetected.length > 0) {
                    return `${combinedDetected[0]} (omit3)`;
                }
            }
        }

        return "Unknown";
    }
}
