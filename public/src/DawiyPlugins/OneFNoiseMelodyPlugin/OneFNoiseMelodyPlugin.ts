import { TEMPO } from "../../Env";
import MIDIRegion from "../../Models/Region/MIDIRegion";
import { MIDINote } from "../../Audio/MIDI/MIDI";
import { MIDI } from "../../Audio/MIDI/MIDI";
import { DAWIYPlugin } from "../IDawiyPlugin";
import DawiyPluginBase from "../DawiyPluginBase";

@DAWIYPlugin
export default class OneFNoiseMelodyPlugin extends DawiyPluginBase {
    id = "one-f-noise-melody";
    name = "1/f Melody Generator";
    description = "Generates melodies using 1/f (pink) noise fluctuation.";
    group = "Generator";

    // Pink Noise State
    private maxKey = 0x1f; // 5 octaves
    private key = 0;
    private whiteValues: number[] = new Array(6).fill(0).map(() => Math.random() - 0.5);

    // Parameters
    private params = {
        startBar: 1,
        startBeat: 1,
        endBar: 5,
        endBeat: 1,
        rootNote: 60, // C4
        scaleType: "major",
        minPitch: 48, // C3
        maxPitch: 84, // C6
        duration: "1/8", // Default eighth notes
        restProbability: 10,
        density: 1
    };


    private durationOptions = [
        { label: "1/16", value: 1 / 16 },
        { label: "1/8", value: 1 / 8 },
        { label: "1/4", value: 1 / 4 },
        { label: "1/2", value: 1 / 2 },
    ];

    constructor(app: any) {
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
        container.style.overflowY = "auto";

        const title = document.createElement("h3");
        title.textContent = this.name;
        title.style.margin = "0 0 10px 0";
        container.appendChild(title);

        const btnContainer = document.createElement("div");
        btnContainer.style.marginTop = "-5px";
        const genBtn = document.createElement("button");
        genBtn.textContent = "Generate Melody";
        genBtn.style.padding = "8px 16px";
        genBtn.style.background = "#d00c85"; // Different color
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
                el.value = opt.value.toString();
                if (opt.value === selected || opt.value.toString() === selected) el.selected = true;
                select.appendChild(el);
            });
            select.onchange = () => {
                const val = options.find(o => o.value.toString() === select.value)?.value;
                onChange(val);
            };
            return select;
        };

        // Range Input
        const rangeContainer = document.createElement("div");
        rangeContainer.style.display = "flex";
        rangeContainer.style.gap = "5px";
        rangeContainer.style.alignItems = "center";
        rangeContainer.appendChild(createNumberInput(this.params.startBar, 1, v => this.params.startBar = v));
        rangeContainer.appendChild(document.createTextNode("Bar"));
        rangeContainer.appendChild(createNumberInput(this.params.startBeat, 1, v => this.params.startBeat = v));
        rangeContainer.appendChild(document.createTextNode(" to "));
        rangeContainer.appendChild(createNumberInput(this.params.endBar, 1, v => this.params.endBar = v));
        rangeContainer.appendChild(document.createTextNode("Bar"));
        rangeContainer.appendChild(createNumberInput(this.params.endBeat, 1, v => this.params.endBeat = v));
        createRow("Time Range:", rangeContainer);

        // Scale
        const scaleOptions = Object.keys(MIDI.scaleTypes).map(k => ({ label: k, value: k }));
        createRow("Scale Type:", createSelect(scaleOptions, this.params.scaleType, v => this.params.scaleType = v));

        // Pitch Range
        const pitchOptions = [];
        for (let i = 0; i <= 127; i++) pitchOptions.push({ label: MIDI.getPitchLabel(i), value: i });
        const pitchContainer = document.createElement("div");
        pitchContainer.style.display = "flex";
        pitchContainer.style.gap = "5px";
        pitchContainer.appendChild(createSelect(pitchOptions, this.params.minPitch, v => this.params.minPitch = v));
        pitchContainer.appendChild(document.createTextNode(" to "));
        pitchContainer.appendChild(createSelect(pitchOptions, this.params.maxPitch, v => this.params.maxPitch = v));
        createRow("Pitch Range:", pitchContainer);

        // Grid/Duration
        createRow("Note Duration:", createSelect(this.durationOptions.map(o => ({ ...o, value: o.label })), this.params.duration, v => this.params.duration = v));

        // Rest Probability
        createRow("Rest Probability (%):", createNumberInput(this.params.restProbability, 0, v => this.params.restProbability = Math.max(0, Math.min(100, v))));

        container.appendChild(form);
    }

    // Voss-McCartney Pink Noise Generator
    private getPinkNoise(): number {
        const lastKey = this.key;
        this.key++;
        if (this.key > this.maxKey) this.key = 0;

        let diff = lastKey ^ this.key;
        let i = 0;
        while ((diff & 1) === 0) {
            diff >>= 1;
            i++;
        }

        // Update the i-th generator
        this.whiteValues[i] = Math.random() - 0.5;

        // Sum all generators
        let total = 0;
        for (let j = 0; j < this.whiteValues.length; j++) {
            total += this.whiteValues[j];
        }

        // Scale down roughly to -1 to 1 range (max sum could be 3, min -3 with 6 generators)
        return total / 3;
    }


    private generate() {
        const track = this.app.tracksController.selectedTrack;
        if (!track) {
            alert("Please select a track first.");
            return;
        }

        const timeSig = this.app.hostView.metronome.timeSignature || [4, 4];
        const num = timeSig[0];
        const den = timeSig[1];

        const quarterNoteMs = (60 / TEMPO) * 1000;
        const quartersPerBar = num * (4 / den);

        const startTotalQuarters = (this.params.startBar - 1) * quartersPerBar + (this.params.startBeat - 1);
        const endTotalQuarters = (this.params.endBar - 1) * quartersPerBar + (this.params.endBeat - 1);

        const startMs = startTotalQuarters * quarterNoteMs;
        const endMs = endTotalQuarters * quarterNoteMs;

        if (endMs <= startMs) {
            alert("End time must be after start time.");
            return;
        }

        const parseDuration = (d: string): number => {
            const [n, dmr] = d.split('/').map(Number);
            return (n / dmr) * 4;
        };
        const durMult = parseDuration(this.params.duration);
        const stepMs = durMult * quarterNoteMs;

        // Prepare Scale Notes
        const validNotes = MIDI.getScaleNotes(this.params.minPitch, this.params.maxPitch, this.params.rootNote, this.params.scaleType);
        if (validNotes.length === 0) {
            alert("No valid notes in range for this scale.");
            return;
        }

        const newNotes: { note: number, start: number, duration: number }[] = [];
        let currentMs = startMs;

        // Seed randomness for this run could be nice, currently using Math.random inside pinkNoise
        // Reset generator state somewhat to avoid correlation with previous run?
        this.whiteValues = new Array(6).fill(0).map(() => Math.random() - 0.5);

        while (currentMs < endMs) {
            // Chance to rest
            if (Math.random() * 100 >= this.params.restProbability) {
                // Generate Pink Noise (-1 to 1)
                const noise = this.getPinkNoise();

                // Map noise to valid notes index
                // Normalize noise: -1..1 -> 0..1
                const normalized = (noise + 1) / 2;
                // Map to index
                let index = Math.floor(normalized * validNotes.length);
                index = Math.max(0, Math.min(validNotes.length - 1, index));

                const pitch = validNotes[index];

                if (currentMs + stepMs <= endMs) {
                    newNotes.push({
                        note: pitch,
                        start: currentMs,
                        duration: stepMs // Simple fixed duration for now
                    });
                }
            }

            currentMs += stepMs;
        }

        if (newNotes.length === 0) return;

        const regionDuration = endMs - startMs;
        const midi = new MIDI(500, regionDuration);

        newNotes.forEach(n => {
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
        console.log(`Generated ${newNotes.length} notes (1/f noise).`);
    }
}
