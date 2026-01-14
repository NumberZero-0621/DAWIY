import App from "../../App";
import { RATIO_MILLS_BY_PX, TEMPO } from "../../Env";
import MIDIRegion from "../../Models/Region/MIDIRegion";
import { MIDINote, MIDI } from "../../Audio/MIDI/MIDI";
import { IDawiyPlugin } from "../IDawiyPlugin";
import { PATTERNS, addNotesForStep, DrumNote, PatternParams } from "./DrumPatterns";

export default class DrumPatternPlugin implements IDawiyPlugin {
    id = "drum-pattern-gen";
    name = "Drum Pattern Generator";
    description = "Generates drum patterns in the selected time range.";

    private app: App;
    private container: HTMLElement | null = null;

    private params: PatternParams = {
        pattern: "basic_rock", // Default needs to match an ID in PATTERNS
        kickNote: 36, // C2
        snareNote: 38, // D2
        hihatNote: 42, // F#2
        velocity: 100
    };

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
        container.style.gap = "10px";

        const title = document.createElement("h3");
        title.textContent = this.name;
        title.style.margin = "0 0 10px 0";
        container.appendChild(title);

        // Pattern Select
        const patternSelect = document.createElement("select");
        patternSelect.style.padding = "5px";
        patternSelect.style.background = "#444";
        patternSelect.style.color = "white";
        patternSelect.style.border = "1px solid #666";

        PATTERNS.forEach(p => {
            const opt = document.createElement("option");
            opt.value = p.id;
            opt.textContent = p.name;
            patternSelect.appendChild(opt);
        });
        patternSelect.value = this.params.pattern;
        patternSelect.onchange = () => this.params.pattern = patternSelect.value;

        const row = document.createElement("div");
        row.style.display = "flex";
        row.style.justifyContent = "space-between";
        row.style.alignItems = "center";
        row.textContent = "Pattern: ";
        row.appendChild(patternSelect);
        container.appendChild(row);

        // Generate Button
        const genBtn = document.createElement("button");
        genBtn.textContent = "Generate Drums in Selection";
        genBtn.style.padding = "10px";
        genBtn.style.background = "#2196F3";
        genBtn.style.color = "white";
        genBtn.style.border = "none";
        genBtn.style.fontSize = "14px";
        genBtn.style.cursor = "pointer";
        genBtn.style.marginTop = "10px";
        genBtn.onclick = () => this.generate();
        container.appendChild(genBtn);

        const help = document.createElement("p");
        help.textContent = "Select a track and highlight a time range on the timeline to generate.";
        help.style.fontSize = "12px";
        help.style.color = "#aaa";
        container.appendChild(help);
    }

    private generate() {
        const track = this.app.tracksController.selectedTrack;
        if (!track) {
            alert("Please select a track first.");
            return;
        }

        const range = this.app.playheadController.getRangePx();
        if (!range) {
            alert("Please select a time range on the timeline.");
            return;
        }

        // Calculate timing
        const startMs = range.start * RATIO_MILLS_BY_PX;
        const endMs = range.end * RATIO_MILLS_BY_PX;
        const durationMs = endMs - startMs;

        if (durationMs <= 0) return;

        const midi = new MIDI(500, durationMs);
        const notes = this.createPattern(startMs, endMs);

        notes.forEach(n => {
            // Note relative to region start
            midi.putNote(new MIDINote(n.pitch, this.params.velocity, 0, n.duration), n.start - startMs);
        });

        const newRegion = new MIDIRegion(midi, startMs);
        //newRegion.regionType.name = "Drums - " + this.params.pattern;

        this.app.doIt(true,
            () => {
                this.app.regionsController.addRegion(track, newRegion);
                if (this.app.pianoRollController.isVisible) this.app.pianoRollController.redraw();
            },
            () => {
                this.app.regionsController.removeRegion(newRegion);
                if (this.app.pianoRollController.isVisible) this.app.pianoRollController.redraw();
            }
        );
    }

    private createPattern(startMs: number, endMs: number): DrumNote[] {
        const notes: DrumNote[] = [];
        const beatMs = (60 / TEMPO) * 1000;
        const sixteenthMs = beatMs / 4;

        const rawStep = Math.round(startMs / sixteenthMs);
        const totalSteps = Math.ceil((endMs - startMs) / sixteenthMs);

        for (let i = 0; i < totalSteps; i++) {
            const absStep = rawStep + i;
            const stepInBar = absStep % 16;
            const time = absStep * sixteenthMs;

            if (time >= endMs) break;
            if (time < startMs) continue;

            addNotesForStep(this.params.pattern, stepInBar, time, sixteenthMs, notes, this.params);
        }

        return notes;
    }
}
