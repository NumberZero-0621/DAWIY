import App from "../App";
import { RATIO_MILLS_BY_PX, TEMPO } from "../Env";
import MIDIRegion from "../Models/Region/MIDIRegion";
import { MIDINote } from "../Audio/MIDI/MIDI";
import { MIDI } from "../Audio/MIDI/MIDI";
import { IDawiyPlugin } from "./IDawiyPlugin";

export default class StochasticGeneratorPlugin implements IDawiyPlugin {
    id = "stochastic-generator";
    name = "Stochastic Note Generator";
    description = "Generates random notes based on probability and density.";

    private app: App;
    private container: HTMLElement | null = null;

    // Parameters
    private params = {
        startBar: 1,
        startBeat: 1,
        endBar: 4,
        endBeat: 4,
        minPitch: 60, // C4
        maxPitch: 72, // C5
        minDuration: "1/16",
        maxDuration: "1/4",
        triplet: false,
        restProbability: 0, // 0-100
        density: 1
    };

    private durationOptions = [
        { label: "1/32", value: 1 / 32 },
        { label: "1/16", value: 1 / 16 },
        { label: "1/8", value: 1 / 8 },
        { label: "1/4", value: 1 / 4 },
        { label: "1/2", value: 1 / 2 },
        { label: "1/1", value: 1 },
        { label: "2/1", value: 2 }
    ];

    // Simple Pitch Map (C-1 to G9 is 0 to 127)
    // C4 is 60.

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
        container.style.justifyContent = "flex-start";
        container.style.alignItems = "stretch";
        container.style.gap = "10px";
        container.style.overflowY = "auto";

        const title = document.createElement("h3");
        title.textContent = this.name;
        title.style.margin = "0 0 10px 0";
        container.appendChild(title);

        // Generate Button (Moved here)
        const btnContainer = document.createElement("div");
        btnContainer.style.marginTop = "-10px";
        btnContainer.style.marginBottom = "-5px";
        const genBtn = document.createElement("button");
        genBtn.textContent = "Generate";
        genBtn.style.padding = "8px 16px";
        genBtn.style.background = "#0c85d0";
        genBtn.style.color = "white";
        genBtn.style.border = "none";
        genBtn.style.borderRadius = "4px";
        genBtn.style.cursor = "pointer";
        genBtn.onclick = () => this.generate();
        btnContainer.appendChild(genBtn);
        container.appendChild(btnContainer);

        const form = document.createElement("div");
        form.style.display = "grid";
        form.style.gridTemplateColumns = "150px 1fr";
        form.style.gap = "8px";
        form.style.alignItems = "center";

        // Helper to create input rows
        const createRow = (label: string, element: HTMLElement) => {
            const labelEl = document.createElement("div");
            labelEl.textContent = label;
            form.appendChild(labelEl);
            form.appendChild(element);
        };

        const createNumberInput = (value: number, min: number, onChange: (val: number) => void) => {
            const input = document.createElement("input");
            input.type = "number";
            input.value = value.toString();
            input.min = min.toString();
            input.style.width = "60px";
            input.style.background = "#444";
            input.style.color = "#fff";
            input.style.border = "1px solid #555";
            input.onchange = () => onChange(parseInt(input.value));
            return input;
        };

        const createSelect = (options: { label: string, value: any }[], selected: any, onChange: (val: any) => void) => {
            const select = document.createElement("select");
            select.style.background = "#444";
            select.style.color = "#fff";
            select.style.border = "1px solid #555";
            options.forEach(opt => {
                const el = document.createElement("option");
                el.textContent = opt.label;
                el.value = opt.value.toString(); // Store as string in value
                if (opt.value === selected || opt.value.toString() === selected) el.selected = true;
                select.appendChild(el);
            });
            select.onchange = () => {
                // Determine if original value was number
                const val = options.find(o => o.value.toString() === select.value)?.value;
                onChange(val);
            };
            return select;
        };

        // Range Input (Bars)
        const rangeContainer = document.createElement("div");
        rangeContainer.style.display = "flex";
        rangeContainer.style.gap = "5px";
        rangeContainer.style.alignItems = "center";
        rangeContainer.appendChild(createNumberInput(this.params.startBar, 1, v => this.params.startBar = v));
        rangeContainer.appendChild(document.createTextNode("Bar"));
        rangeContainer.appendChild(createNumberInput(this.params.startBeat, 1, v => this.params.startBeat = v));
        rangeContainer.appendChild(document.createTextNode("Beat  to  "));
        rangeContainer.appendChild(createNumberInput(this.params.endBar, 1, v => this.params.endBar = v));
        rangeContainer.appendChild(document.createTextNode("Bar"));
        rangeContainer.appendChild(createNumberInput(this.params.endBeat, 1, v => this.params.endBeat = v));
        rangeContainer.appendChild(document.createTextNode("Beat"));
        createRow("Generate Range:", rangeContainer);

        // Pitch Range
        const pitchOptions = [];
        for (let i = 0; i <= 127; i++) {
            pitchOptions.push({ label: MIDI.getPitchLabel(i), value: i });
        }
        const pitchContainer = document.createElement("div");
        pitchContainer.style.display = "flex";
        pitchContainer.style.gap = "5px";
        pitchContainer.appendChild(createSelect(pitchOptions, this.params.minPitch, v => this.params.minPitch = v));
        pitchContainer.appendChild(document.createTextNode(" to "));
        pitchContainer.appendChild(createSelect(pitchOptions, this.params.maxPitch, v => this.params.maxPitch = v));
        createRow("Pitch Range:", pitchContainer);

        // Duration Range
        const durContainer = document.createElement("div");
        durContainer.style.display = "flex";
        durContainer.style.gap = "5px";
        durContainer.appendChild(createSelect(this.durationOptions.map(o => ({ ...o, value: o.label })), this.params.minDuration, v => this.params.minDuration = v));
        durContainer.appendChild(document.createTextNode(" to "));
        durContainer.appendChild(createSelect(this.durationOptions.map(o => ({ ...o, value: o.label })), this.params.maxDuration, v => this.params.maxDuration = v));
        createRow("Duration Range:", durContainer);

        // Triplet
        const tripletCheck = document.createElement("input");
        tripletCheck.type = "checkbox";
        tripletCheck.style.justifySelf = "start";
        tripletCheck.style.cursor = "pointer";
        tripletCheck.checked = this.params.triplet;
        tripletCheck.onchange = () => this.params.triplet = tripletCheck.checked;
        createRow("Allow Triplets:", tripletCheck);

        // Rest Probability
        const restInput = createNumberInput(this.params.restProbability, 0, v => this.params.restProbability = Math.max(0, Math.min(100, v)));
        restInput.max = "100";
        createRow("Rest Probability (%):", restInput);

        // Density
        const densityInput = createNumberInput(this.params.density, 0, v => this.params.density = Math.max(0, v));
        createRow("Density:", densityInput);

        container.appendChild(form);
    }

    private generate() {
        const track = this.app.tracksController.selectedTrack;
        if (!track) {
            alert("Please select a track first.");
            return;
        }

        // Calculation of time range
        // Assuming 4/4 signature for simplification or get from Metronome
        const timeSig = this.app.hostView.metronome.timeSignature || [4, 4];
        const num = timeSig[0];
        const den = timeSig[1];

        // Beat duration in ms = (60 / TEMPO) * 1000
        // But "Beat" usually refers to the denominator note.
        // In 4/4, a beat is a quarter note.
        // In 6/8, a beat is an eighth note (usually grouped, but let's stick to simple calc).

        // 1 Beat (Quarter note usually) duration in MS
        const beatDurationMs = (60 / TEMPO) * 1000;
        // 1 Bar duration = beatDurationMs * num * (4 / den) ? 
        // If 4/4: 1 beat = 1/4 note. Bar = 4 beats.
        // If 6/8: 1 beat = 1/8 note (if we define beat as denominator). Bar = 6 beats.
        // Standard definition: Beat duration depends on tempo which is usually BPM (Quarter notes per minute).
        // Let's assume TEMPO is BPM (Quarter notes).

        const quarterNoteMs = (60 / TEMPO) * 1000;

        // Calculate offset for Start
        // (Bar - 1) * BarDuration + (Beat - 1) * BeatDuration
        // We need to know how many Quarter notes in a Bar.
        // 4/4 -> 4 quarters. 3/4 -> 3 quarters. 6/8 -> 3 quarters equivalent (6 eighths).
        const quartersPerBar = num * (4 / den);

        const startTotalQuarters = (this.params.startBar - 1) * quartersPerBar + (this.params.startBeat - 1);
        const endTotalQuarters = (this.params.endBar - 1) * quartersPerBar + (this.params.endBeat - 1);

        const startMs = startTotalQuarters * quarterNoteMs;
        const endMs = endTotalQuarters * quarterNoteMs;

        if (endMs <= startMs) {
            alert("End time must be after start time.");
            return;
        }

        // Duration Values Map (fraction to quarter notes multiplier)
        // 1/4 = 1 quarter note
        // 1/16 = 0.25 quarter note
        const parseDuration = (d: string): number => {
            const [n, dmr] = d.split('/').map(Number);
            return (n / dmr) * 4; // Multiplier relative to Quarter Note (1/4)
        };

        const minDurMult = parseDuration(this.params.minDuration);
        const maxDurMult = parseDuration(this.params.maxDuration);

        const newNotes: { note: number, start: number, duration: number }[] = [];

        for (let d = 0; d < this.params.density; d++) {
            let currentMs = startMs;

            while (currentMs < endMs) {
                // 1. Rest or Note?
                const isRest = Math.random() * 100 < this.params.restProbability;

                // 2. Duration
                let durMult = minDurMult + Math.random() * (maxDurMult - minDurMult);

                // Triplet logic: random chance to be 2/3 of a standard value? 
                // Or just allow the random duration to be multiplied by 2/3?
                if (this.params.triplet && Math.random() < 0.5) {
                    durMult *= (2 / 3);
                }

                // Snap duration to standard values? User didn't strictly say, but usually preferred.
                // The prompt says "choose from shortest to longest". 
                // Let's pick a random value from the list that is within range.
                const validOptions = this.durationOptions.filter(o => {
                    const valMult = o.value * 4;
                    return valMult >= minDurMult && valMult <= maxDurMult;
                });

                if (validOptions.length > 0) {
                    const chosen = validOptions[Math.floor(Math.random() * validOptions.length)];
                    durMult = chosen.value * 4;
                }

                if (this.params.triplet && Math.random() < 0.3) { // 30% chance for triplet if enabled
                    durMult *= (2 / 3);
                }

                const durationMs = durMult * quarterNoteMs;

                if (!isRest) {
                    // 3. Pitch
                    const pitch = Math.floor(this.params.minPitch + Math.random() * (this.params.maxPitch - this.params.minPitch + 1));

                    if (currentMs + durationMs <= endMs) {
                        newNotes.push({
                            note: pitch,
                            start: currentMs,
                            duration: durationMs
                        });
                    }
                }

                currentMs += durationMs;
                // If rest, we just advanced time (transparent note)
            }
        }

        if (newNotes.length === 0) return;

        // Add notes to track
        // We need to create a region or add to existing.
        // Simple approach: Create a new Region covering the range.
        const regionDuration = endMs - startMs;
        const midi = new MIDI(500, regionDuration);
        // Initialize MIDI duration

        newNotes.forEach(n => {
            // Note start is relative to Region start
            const localStart = n.start - startMs;
            midi.putNote(new MIDINote(n.note, 100, 0, n.duration), localStart);
        });

        const newRegion = new MIDIRegion(midi, startMs);

        const redo = () => {
            this.app.regionsController.addRegion(track, newRegion);
            if (this.app.pianoRollController.isVisible) {
                this.app.pianoRollController.redraw();
            }
        };
        const undo = () => {
            this.app.regionsController.removeRegion(newRegion);
            if (this.app.pianoRollController.isVisible) {
                this.app.pianoRollController.redraw();
            }
        };

        this.app.doIt(true, redo, undo);

        console.log(`Generated ${newNotes.length} notes.`);
    }
}
