
import App from "../../App";
import { IDawiyPlugin } from "../IDawiyPlugin";
import { MIDINote } from "../../Audio/MIDI/MIDI";

const NOTE_NAMES = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];

interface ChordPattern {
    name: string;
    intervals: number[];
}

const CHORDS: ChordPattern[] = [
    { name: "", intervals: [0, 4, 7] }, // Major
    { name: "m", intervals: [0, 3, 7] }, // Minor
    { name: "dim", intervals: [0, 3, 6] },
    { name: "aug", intervals: [0, 4, 8] },
    { name: "sus4", intervals: [0, 5, 7] },
    { name: "sus2", intervals: [0, 2, 7] },
    { name: "7", intervals: [0, 4, 7, 10] },
    { name: "maj7", intervals: [0, 4, 7, 11] },
    { name: "m7", intervals: [0, 3, 7, 10] },
    { name: "m7b5", intervals: [0, 3, 6, 10] },
    { name: "dim7", intervals: [0, 3, 6, 9] },
    { name: "6", intervals: [0, 4, 7, 9] },
    { name: "m6", intervals: [0, 3, 7, 9] },
];

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
        // We cast to any because TS might not know about the property we just added unless we update types def, 
        // but at runtime it will exist.
        const pianoRoll = this.app.pianoRollController as any;

        let notes: MIDINote[] = [];
        if (pianoRoll && pianoRoll.selectedNotes) {
            notes = Array.from(pianoRoll.selectedNotes);
            console.log("C5thPlugin: selectedNotes size:", notes.length);
        } else {
            console.log("C5thPlugin: pianoRoll or selectedNotes missing", !!pianoRoll);
        }

        if (notes.length === 0) {
            this.chordDisplay.textContent = "--";
            return;
        }

        // Detect Chord
        console.log("C5thPlugin: Detecting chord for notes:", notes.map(n => n.note));
        const chordName = this.detectChord(notes);
        this.chordDisplay.textContent = chordName;
    }

    private detectChord(notes: MIDINote[]): string {
        if (notes.length === 0) return "--";

        // 1. ノートを高さ順にソートし、ベース音（最低音）を特定
        const sortedNotes = [...notes].sort((a, b) => a.note - b.note);
        const bassNotePC = sortedNotes[0].note % 12;

        // 2. ユニークなピッチクラス(PC)を抽出
        const pcs = Array.from(new Set(notes.map(n => n.note % 12)));

        if (pcs.length === 1) return NOTE_NAMES[pcs[0]];

        // 3. ルート候補の作成：ベース音を最優先し、残りは数値順
        // これにより転回形よりもルートポジションの判定が優先されやすくなる
        const rootCandidates = [
            bassNotePC,
            ...pcs.filter(p => p !== bassNotePC).sort((a, b) => a - b)
        ];

        // 4. 候補ごとにパターンマッチング
        for (const root of rootCandidates) {
            // 現在のルート候補に対するインターバル算出
            const intervals = pcs.map(p => (p - root + 12) % 12).sort((a, b) => a - b);

            for (const pattern of CHORDS) {
                if (this.arraysEqual(intervals, pattern.intervals)) {
                    return NOTE_NAMES[root] + pattern.name;
                }
            }
        }

        return "Unknown";
    }

    private arraysEqual(a: number[], b: number[]) {
        if (a.length !== b.length) return false;
        for (let i = 0; i < a.length; i++) {
            if (a[i] !== b[i]) return false;
        }
        return true;
    }
}
