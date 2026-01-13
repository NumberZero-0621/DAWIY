import App from "../../App";
import { RATIO_MILLS_BY_PX, TEMPO } from "../../Env";
import { IDawiyPlugin } from "../IDawiyPlugin";
import Region, { RegionOf } from "../../Models/Region/Region";
import MIDIRegion from "../../Models/Region/MIDIRegion";
import SampleRegion from "../../Models/Region/SampleRegion";
import { MIDI, MIDINote } from "../../Audio/MIDI/MIDI";
import { audioCtx } from "../../index";

export default class GlitchChopperPlugin implements IDawiyPlugin {
    id = "glitch-chopper";
    name = "Glitch Chopper";
    description = "Slices selection into grid parts and randomly deletes or merges them.";

    private app: App;
    private container: HTMLElement | null = null;

    private params = {
        grid: "1/16",
        deleteChance: 10,
        mergeChance: 50
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
                const processed = this.processMIDI(newMidi, relativeStart, relativeEnd, stepMs);

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
                this.processAudio(newBuffer, relativeStart, relativeEnd, stepMs);

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
        // Strategy:
        // 1. Slice all notes in the range into 'stepMs' segments.
        // 2. Iterate segments and apply Delete/Merge logic.

        // 1. Slice
        // We need to iterate existing notes and if they cross a grid line, split them.
        // Or simpler: Rebuild the MIDI track.

        // Let's gather all notes first.
        const notes: { note: MIDINote, start: number }[] = [];
        midi.forEachNote((note, noteStart) => {
            notes.push({ note, start: noteStart });
        });

        // Clear MIDI (we will rebuild it)
        // midi is a clone, so we can clear its instants.
        // But MIDI class structure is array of instants.
        // Best way is to create a new empty MIDI and fill it.
        // Actually, let's just make a new MIDI object entirely, which we did with clone().
        // But we want to modify 'newMidi'.
        // Let's clear 'newMidi' instants.
        // The MIDI class doesn't have a clear() method but we can re-initialize or validly use PutNote on a fresh one.
        // But we want to keep notes OUTSIDE the selection.

        // So, filtering:
        const outsideNotes = notes.filter(n => n.start + n.note.duration <= startMs || n.start >= endMs);
        const insideNotes = notes.filter(n => !(n.start + n.note.duration <= startMs || n.start >= endMs));

        // Create a temporary list for processed inside notes
        let processedNotes: { note: MIDINote, start: number }[] = [];

        // Chop insideNotes into grid steps
        // First align startMs to grid? The user selection might not be aligned.
        // Let's assume the grid starts at 'startMs' or global grid?
        // Usually global grid.
        // Let's use global grid relative to 0.
        // But our coordinates are relative to Region Start.
        // So global time = region.start + note.start.

        // This is complicated. Let's simplify: Grid starts at 'startMs' (Selection Start).
        // This makes sense for a "Selected Area Chopper".

        insideNotes.forEach(item => {
            const absStart = item.start; // Relative to region
            const absEnd = item.start + item.note.duration;

            // We only chop the part intersecting [startMs, endMs].
            // The part outside should be preserved?
            // Wait, we filtered 'insideNotes' as essentially "Touching" the range.
            // We should split the notes at startMs and endMs first to safeguard outside parts.

            // This logic allows for notes to be partially outside.

            // Implementation detail:
            // Iterate time from startMs to endMs by stepMs.
            // This defines "Grid Slots".
            // For each slot, we identify note segments.

            // Better:
            // 1. Quantize the note into strict Step-sized blocks for the duration it covers within [startMs, endMs].
            // 2. Keep parts outside [startMs, endMs] as is.

            // START PROCESSING

            // Handle Start overlap
            if (absStart < startMs) {
                processedNotes.push({
                    note: new MIDINote(item.note.note, item.note.velocity, item.note.channel, startMs - absStart),
                    start: absStart
                });
            }

            // Handle End overlap
            if (absEnd > endMs) {
                processedNotes.push({
                    note: new MIDINote(item.note.note, item.note.velocity, item.note.channel, absEnd - endMs),
                    start: endMs
                });
            }

            // Handle Inner part
            const innerStart = Math.max(absStart, startMs);
            const innerEnd = Math.min(absEnd, endMs);

            if (innerEnd > innerStart) {
                // Slice this range into steps
                // Align to first step boundary relative to startMs
                // Step 0: startMs
                // Step 1: startMs + stepMs

                let currentPos = innerStart;
                while (currentPos < innerEnd) {
                    // Find next grid line
                    const relativeP = currentPos - startMs;
                    const nextGridIndex = Math.floor(relativeP / stepMs) + 1;
                    const nextGridPos = startMs + (nextGridIndex * stepMs);

                    const segEnd = Math.min(innerEnd, nextGridPos);
                    const duration = segEnd - currentPos;

                    if (duration > 0.1) { // Avoid micro slices
                        processedNotes.push({
                            note: new MIDINote(item.note.note, item.note.velocity, item.note.channel, duration),
                            start: currentPos
                        });
                    }
                    currentPos = segEnd;
                }
            }
        });

        // Now 'processedNotes' contains safe outside parts and finely chopped inside parts.
        // We need to apply logic to the inside parts (those between startMs and endMs).

        // Group by Grid Step
        const notesByStep: { [key: number]: { note: MIDINote, start: number }[] } = {};
        const steps: number[] = [];

        // Helper to get step index
        const getStepIndex = (time: number) => Math.floor((time - startMs + 0.1) / stepMs); // +0.1 tolerance

        processedNotes.forEach(item => {
            if (item.start >= startMs - 0.1 && item.start < endMs - 0.1) {
                const stepIdx = getStepIndex(item.start);
                if (!notesByStep[stepIdx]) {
                    notesByStep[stepIdx] = [];
                    steps.push(stepIdx);
                }
                notesByStep[stepIdx].push(item);
            }
        });

        // Sort steps
        steps.sort((a, b) => a - b);

        const deletedSteps = new Set<number>();
        const mergedSteps = new Set<number>(); // Step I merged with Step I+1

        // 2. Apply Delete
        steps.forEach(step => {
            if (Math.random() * 100 < this.params.deleteChance) {
                deletedSteps.add(step);
            }
        });

        // 3. Apply Merge (Tie)
        // Iterate steps. If step I and step I+1 are NOT deleted...
        for (let i = 0; i < steps.length - 1; i++) {
            const currentStep = steps[i];
            const nextStep = steps[i + 1];

            // Only merge adjacent steps
            if (nextStep !== currentStep + 1) continue;

            if (!deletedSteps.has(currentStep) && !deletedSteps.has(nextStep)) {
                if (Math.random() * 100 < this.params.mergeChance) {
                    // Try to merge notes from current to next
                    mergedSteps.add(currentStep);
                }
            }
        }

        // 4. Reconstruct Notes
        // We will build a final list.
        // Outside notes are kept.
        // Inside notes:
        // If deleted -> skip.
        // If merged -> combine with next.

        // We need to be careful about merging.
        // If we merge Step 0 and Step 1, we look for notes in Step 0 that match notes in Step 1?
        // Actually, since we sliced a single note into pieces, they WILL match (same pitch/channel).
        // So we just join them back.

        // NOTE: If we have multiple notes (chord), we match them by pitch.

        let finalNotes = processedNotes.filter(n => n.start < startMs || n.start >= endMs); // The safe outside parts

        // Process inside parts
        // Collect all inside notes
        let insideParts = processedNotes.filter(n => n.start >= startMs - 0.1 && n.start < endMs - 0.1);

        // Sort by start time.
        insideParts.sort((a, b) => a.start - b.start);

        // Map notes to their active state?
        // Easier: Convert to linked list or iterate?
        // Let's use the 'notesByStep' map we built.

        // For each step in order:
        // If deleted, skip.
        // If not deleted:
        //   Check if merged with next.
        //   If merged:
        //      Take notes in current step.
        //      Find corresponding notes in next step.
        //      Extend current note duration.
        //      Remove corresponding note from next step (mark as consumed).
        //   If not merged:
        //      Add to final.

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
                    // Find match in next step
                    // Same pitch, same channel.
                    // Also start time of next note should be exactly item.end (continuity).
                    const match = nextStepNotes.find(n =>
                        !consumedNotes.has(n) &&
                        n.note.note === item.note.note &&
                        Math.abs((item.start + item.note.duration) - n.start) < 1 // tolerance
                    );

                    if (match) {
                        // MERGE
                        // Start a new note starting at item.start, duration = item + match
                        // But wait, what if we merge 3 steps?
                        // We shouldn't create the note yet. We should modify 'match' to encompass 'item'?
                        // Or modify 'item' to encompass 'match' and keep 'item' for next iteration?

                        // Let's assume 'match' is the container for the next step.
                        // We extend 'item' and put it into 'nextStepNotes' replacing 'match'? 
                        // No, that breaks the loop.

                        // Better: Extend 'item' duration.
                        // Mark 'match' as consumed.
                        // Add 'item' to 'nextStepNotes' logic for further merging?
                        // Yes!

                        // Create a new merged note object
                        const newNote = new MIDINote(item.note.note, item.note.velocity, item.note.channel, item.note.duration + match.note.duration);
                        const newItem = { note: newNote, start: item.start };

                        consumedNotes.add(match);

                        // We need to inject this into the NEXT processing loop so it can be merged again.
                        // But 'notesByStep' is fixed.
                        // We can modify 'notesByStep[step+1]'?
                        // Or just carry over?

                        // Mutating 'match' inside notesByStep[step+1] is dangerous but effective.
                        // We replace 'match' with 'newItem' (which has earlier start).
                        const matchIdx = nextStepNotes.indexOf(match);
                        nextStepNotes[matchIdx] = newItem;

                        // We don't add to finalNotes yet. It will be processed in next step.
                    } else {
                        // No match to merge with, so just keep this note.
                        finalNotes.push(item);
                    }
                } else {
                    // Not merging, just keep.
                    finalNotes.push(item);
                }
            });
        });

        // Finally, 'finalNotes' has everything.
        // Write back to MIDI (New object)

        // Clear old instants from newMidi? We can't.
        // We have to overwrite 'newMidi.instants'.
        // Or create a fresh one and copy properties.

        const builtMidi = MIDI.empty(midi.instant_duration, midi.duration);
        finalNotes.forEach(item => {
            builtMidi.putNote(item.note, item.start);
        });

        return builtMidi;
    }



    private processAudio(buffer: any, startMs: number, endMs: number, stepMs: number) {
        // SampleRegion buffer is OperableAudioBuffer
        // We need to write silence to deleted steps.

        const sampleRate = buffer.sampleRate;
        const startSample = Math.floor(startMs * sampleRate / 1000);
        const endSample = Math.floor(endMs * sampleRate / 1000);
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
                        data[pos + i] = 0;
                    }
                }
            }
        }
    }
}
