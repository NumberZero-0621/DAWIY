import App from "../../App";
import { RATIO_MILLS_BY_PX, TEMPO } from "../../Env";
import { DAWIYPlugin } from "../IDawiyPlugin";
import DawiyPluginBase from "../DawiyPluginBase";
import Region, { RegionOf } from "../../Models/Region/Region";
import MIDIRegion from "../../Models/Region/MIDIRegion";
import SampleRegion from "../../Models/Region/SampleRegion";
import { MIDI, MIDINote } from "../../Audio/MIDI/MIDI";
import { audioCtx } from "../../index";

@DAWIYPlugin
export default class GlitchChopperPlugin extends DawiyPluginBase {
    id = "glitch-chopper";
    name = "Glitch Chopper";
    description = "Slices selection into grid parts and randomly deletes or merges them.";
    group = "Generator";

    private params = {
        grid: "1/16",
        deleteChance: 10,
        mergeChance: 50
    };

    constructor(app: App) {
        super(app);
    }

    public override render(container: HTMLElement) {
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

        const form = document.createElement("div");
        form.style.display = "grid";
        form.style.gridTemplateColumns = "120px 1fr";
        form.style.gap = "8px";

        // Grid Select
        const gridSelect = document.createElement("select");
        gridSelect.style.background = "#444";
        gridSelect.style.color = "white";
        ["1/16", "1/32"].forEach(g => {
            const opt = document.createElement("option");
            opt.value = g;
            opt.textContent = g;
            if (g === this.params.grid) opt.selected = true;
            gridSelect.appendChild(opt);
        });
        gridSelect.onchange = () => this.params.grid = gridSelect.value;
        this.createRow(form, "Grid Size:", gridSelect);

        // Delete Chance
        const delContainer = document.createElement("div");
        delContainer.style.display = "flex";
        delContainer.style.gap = "5px";
        const delInput = document.createElement("input");
        delInput.type = "range";
        delInput.min = "0";
        delInput.max = "100";
        delInput.value = this.params.deleteChance.toString();
        const delVal = document.createElement("span");
        delVal.textContent = this.params.deleteChance + "%";
        delInput.oninput = () => {
            this.params.deleteChance = parseInt(delInput.value);
            delVal.textContent = this.params.deleteChance + "%";
        };
        delContainer.appendChild(delInput);
        delContainer.appendChild(delVal);
        this.createRow(form, "Delete (Rest) %:", delContainer);

        // Merge Chance
        const mergeContainer = document.createElement("div");
        mergeContainer.style.display = "flex";
        mergeContainer.style.gap = "5px";
        const mergeInput = document.createElement("input");
        mergeInput.type = "range";
        mergeInput.min = "0";
        mergeInput.max = "100";
        mergeInput.value = this.params.mergeChance.toString();
        const mergeVal = document.createElement("span");
        mergeVal.textContent = this.params.mergeChance + "%";
        mergeInput.oninput = () => {
            this.params.mergeChance = parseInt(mergeInput.value);
            mergeVal.textContent = this.params.mergeChance + "%";
        };
        mergeContainer.appendChild(mergeInput);
        mergeContainer.appendChild(mergeVal);
        this.createRow(form, "Merge (Tie) %:", mergeContainer);

        container.appendChild(form);

        const btn = document.createElement("button");
        btn.textContent = "Chop!";
        btn.style.padding = "10px";
        btn.style.background = "#E91E63";
        btn.style.color = "white";
        btn.style.border = "none";
        btn.style.cursor = "pointer";
        btn.style.marginTop = "10px";
        btn.onclick = () => this.chop();
        container.appendChild(btn);

        const help = document.createElement("p");
        help.textContent = "Select a region and time range. Modifies content in-place.";
        help.style.fontSize = "12px";
        help.style.color = "#aaa";
        container.appendChild(help);
    }

    private createRow(parent: HTMLElement, label: string, el: HTMLElement) {
        const l = document.createElement("div");
        l.textContent = label;
        parent.appendChild(l);
        parent.appendChild(el);
    }

    private chop() {
        const track = this.app.tracksController.selectedTrack;
        if (!track) {
            alert("No track selected.");
            return;
        }

        const range = this.app.playheadController.getRangePx();
        if (!range) {
            alert("No time range selected.");
            return;
        }

        const startMs = range.start * RATIO_MILLS_BY_PX;
        const endMs = range.end * RATIO_MILLS_BY_PX;

        // Calculate Grid
        const beatMs = (60 / TEMPO) * 1000;
        let stepMs = beatMs / 4; // 1/16
        if (this.params.grid === "1/32") stepMs = beatMs / 8;

        const affectedRegions: { region: RegionOf<any>, oldContent: any, newContent: any }[] = [];

        // Identify overlapping regions
        ([...track.regions] as RegionOf<any>[]).forEach(region => {
            if (region.end <= startMs || region.start >= endMs) return;

            // Only process MIDI or Sample regions
            if (region instanceof MIDIRegion) {
                const midi = region.midi;
                const newMidi = midi.clone();

                // Define range relative to region start
                const relativeStart = Math.max(0, startMs - region.start);
                const relativeEnd = Math.min(region.duration, endMs - region.start);

                if (relativeEnd <= relativeStart) return; // Should not happen given overlap check

                // Process MIDI
                const processed = newMidi.glitch(stepMs, this.params.deleteChance, this.params.mergeChance, relativeStart, relativeEnd);

                affectedRegions.push({
                    region: region,
                    oldContent: midi,
                    newContent: processed
                });

            } else if (region instanceof SampleRegion) {
                const buffer = region.buffer;
                const newBuffer = buffer.clone();

                // Define range relative to region start
                const relativeStart = Math.max(0, startMs - region.start);
                const relativeEnd = Math.min(region.duration, endMs - region.start);

                if (relativeEnd <= relativeStart) return;

                // Process Audio
                region.silenceSteps(stepMs, this.params.deleteChance);

                affectedRegions.push({
                    region: region,
                    oldContent: buffer,
                    newContent: newBuffer
                });
            }
        });

        if (affectedRegions.length === 0) return;

        this.app.doIt(true,
            () => {
                affectedRegions.forEach(item => {
                    if (item.region instanceof MIDIRegion) {
                        item.region.midi = item.newContent as MIDI;
                    } else if (item.region instanceof SampleRegion) {
                        item.region.buffer = item.newContent;
                    }
                    this.app.regionsController.updateRegionView(item.region);
                });
                if (this.app.pianoRollController.isVisible) this.app.pianoRollController.redraw();
            },
            () => {
                affectedRegions.forEach(item => {
                    if (item.region instanceof MIDIRegion) {
                        item.region.midi = item.oldContent as MIDI;
                    } else if (item.region instanceof SampleRegion) {
                        item.region.buffer = item.oldContent;
                    }
                    this.app.regionsController.updateRegionView(item.region);
                });
                if (this.app.pianoRollController.isVisible) this.app.pianoRollController.redraw();
            }
        );
    }

    private processMIDI(midi: MIDI, startMs: number, endMs: number, stepMs: number): MIDI {
        // 1. Slice notes (Chop logic is now in MIDI class)
        const choppedMidi = midi.chop(stepMs, startMs, endMs);

        // 2 & 3. Apple Logic (Delete/Merge)
        // We only modify the "inside" notes. The chop method already preserved "outside" notes.
        // But chop method returned a SINGLE MIDI object with EVERYTHING.

        // We need to identify which notes are "inside" to apply effects.
        // Actually, chop logic only chops inside notes. Outside notes are kept as is (long).
        // So we can filter notes that are "short" (<= stepMs) AND inside the range?
        // Or better: filter by position.

        // Let's get all notes from the chopped midi.
        let allNotes = choppedMidi.notes;

        // Separate Logic Notes (Active Range) vs Preserved Notes
        // Notes strictly within the range [startMs, endMs) are the chopped ones.
        // Due to floating point usage in chop, let's use a small epsilon.

        const insideNotes: { note: MIDINote, start: number }[] = [];
        const outsideNotes: { note: MIDINote, start: number }[] = [];

        // Identify grid slots to reconstruct logic
        // We need to group inside notes by "Step Index".
        const getStepIndex = (time: number) => Math.floor((time - startMs + 0.1) / stepMs);

        const notesByStep: { [key: number]: { note: MIDINote, start: number }[] } = {};
        const steps: number[] = [];

        allNotes.forEach(item => {
            // Check if item is within process range
            // Logic: if it starts >= startMs and ends <= endMs
            // Actually, chop guarantees chopped notes are fully inside.
            // Check start time.
            if (item.start >= startMs - 0.1 && item.start < endMs - 0.1) {
                insideNotes.push(item);
                const stepIdx = getStepIndex(item.start);
                if (!notesByStep[stepIdx]) {
                    notesByStep[stepIdx] = [];
                    steps.push(stepIdx);
                }
                notesByStep[stepIdx].push(item);
            } else {
                outsideNotes.push(item);
            }
        });

        steps.sort((a, b) => a - b);

        const deletedSteps = new Set<number>();
        const mergedSteps = new Set<number>();

        // Apply Delete
        steps.forEach(step => {
            if (Math.random() * 100 < this.params.deleteChance) {
                deletedSteps.add(step);
            }
        });

        // Apply Merge
        for (let i = 0; i < steps.length - 1; i++) {
            const currentStep = steps[i];
            const nextStep = steps[i + 1];

            // Only merge adjacent steps
            if (nextStep !== currentStep + 1) continue;

            if (!deletedSteps.has(currentStep) && !deletedSteps.has(nextStep)) {
                if (Math.random() * 100 < this.params.mergeChance) {
                    mergedSteps.add(currentStep);
                }
            }
        }

        // Reconstruct
        const finalNotes = [...outsideNotes];
        const consumedNotes = new Set<{ note: MIDINote, start: number }>();

        steps.forEach(step => {
            if (deletedSteps.has(step)) return;

            const stepNotes = notesByStep[step];
            if (!stepNotes) return;

            const isMerging = mergedSteps.has(step);
            const nextStepNotes = notesByStep[step + 1];

            stepNotes.forEach(item => {
                if (consumedNotes.has(item)) return;

                if (isMerging && nextStepNotes) {
                    // Try Merge
                    const match = nextStepNotes.find(n =>
                        !consumedNotes.has(n) &&
                        n.note.note === item.note.note &&
                        Math.abs((item.start + item.note.duration) - n.start) < 1
                    );

                    if (match) {
                        // Merge logic
                        const newNote = new MIDINote(item.note.note, item.note.velocity, item.note.channel, item.note.duration + match.note.duration);
                        const newItem = { note: newNote, start: item.start };

                        consumedNotes.add(match);

                        // Replace match in next step to allow chain merging
                        const matchIdx = nextStepNotes.indexOf(match);
                        if (matchIdx !== -1) {
                            nextStepNotes[matchIdx] = newItem;
                        }
                    } else {
                        finalNotes.push(item);
                    }
                } else {
                    finalNotes.push(item);
                }
            });
        });

        return MIDI.fromNotes(finalNotes, midi.instant_duration);
    }



    private processAudio(buffer: any, startMs: number, endMs: number, stepMs: number) {
        // SampleRegion buffer is OperableAudioBuffer
        // We need to write silence to deleted steps.

        const sampleRate = buffer.sampleRate;
        // Convert milliseconds to samples, relative to the start of the buffer
        const bufferStartMs = 0; // The buffer passed here is already relative to the region start
        const startSample = Math.floor((startMs - bufferStartMs) * sampleRate / 1000);
        const endSample = Math.floor((endMs - bufferStartMs) * sampleRate / 1000);
        const stepSamples = Math.floor(stepMs * sampleRate / 1000);

        // Iterate steps
        for (let pos = startSample; pos < endSample; pos += stepSamples) {
            // Check bounds
            const currentEnd = Math.min(pos + stepSamples, endSample);
            const length = currentEnd - pos;

            // Delete Chance
            if (Math.random() * 100 < this.params.deleteChance) {
                // Silence this range
                for (let c = 0; c < buffer.numberOfChannels; c++) {
                    const data = buffer.getChannelData(c);
                    // Fill with 0
                    for (let i = 0; i < length; i++) {
                        if (pos + i < data.length) { // Ensure we don't write out of bounds
                            data[pos + i] = 0;
                        }
                    }
                }
            }
        }
    }
}
