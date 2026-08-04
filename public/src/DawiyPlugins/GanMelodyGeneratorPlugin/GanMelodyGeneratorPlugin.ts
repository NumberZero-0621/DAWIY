import App from "../../App";
import { TEMPO } from "../../Env";
import MIDIRegion from "../../Models/Region/MIDIRegion";
import { MIDINote, MIDI } from "../../Audio/MIDI/MIDI";
import { DAWIYPlugin } from "../IDawiyPlugin";
import DawiyPluginBase from "../DawiyPluginBase";

@DAWIYPlugin
export default class GanMelodyGeneratorPlugin extends DawiyPluginBase {
    id = "gan-melody-generator";
    name = "GAN Melody Generator";
    description = "Generates melodies via external GAN API server.";
    group = "Generator";

    // Params
    private params = {
        apiEndpoint: "http://localhost:8000/generate",
        lengthBars: 4,
        lengthBeats: 0,
        seed: -1,
        minPitch: 60, // C4
        maxPitch: 84, // C6
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
        container.style.overflowY = "auto";

        const title = document.createElement("h3");
        title.textContent = this.name;
        title.style.margin = "0 0 10px 0";
        container.appendChild(title);

        const btnContainer = document.createElement("div");
        const genBtn = document.createElement("button");
        genBtn.textContent = "Generate (Fetch from API)";
        genBtn.style.padding = "8px 16px";
        genBtn.style.background = "#8e44ad";
        genBtn.style.color = "white";
        genBtn.style.border = "none";
        genBtn.style.borderRadius = "4px";
        genBtn.style.cursor = "pointer";
        genBtn.onclick = () => this.generate();
        btnContainer.appendChild(genBtn);
        container.appendChild(btnContainer);

        const form = document.createElement("div");
        form.style.display = "grid";
        form.style.gridTemplateColumns = "180px 1fr";
        form.style.gap = "8px";
        form.style.alignItems = "center";

        const createRow = (label: string, element: HTMLElement) => {
            const labelEl = document.createElement("div");
            labelEl.textContent = label;
            form.appendChild(labelEl);
            form.appendChild(element);
        };

        const createTextInput = (value: string, onChange: (val: string) => void) => {
            const input = document.createElement("input");
            input.type = "text";
            input.value = value;
            input.style.width = "100%";
            input.style.background = "#444";
            input.style.color = "#fff";
            input.style.border = "1px solid #555";
            input.onchange = () => onChange(input.value);
            return input;
        };

        const createNumberInput = (value: number, min: number, max: number | null, step: number, onChange: (val: number) => void) => {
            const input = document.createElement("input");
            input.type = "number";
            input.value = value.toString();
            input.min = min.toString();
            if (max !== null) input.max = max.toString();
            input.step = step.toString();
            input.style.width = "60px";
            input.style.background = "#444";
            input.style.color = "#fff";
            input.style.border = "1px solid #555";
            input.onchange = () => onChange(parseFloat(input.value));
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

        // API Endpoint
        createRow("API Endpoint:", createTextInput(this.params.apiEndpoint, v => this.params.apiEndpoint = v));

        // Generation Length
        const lengthContainer = document.createElement("div");
        lengthContainer.style.display = "flex";
        lengthContainer.style.gap = "5px";
        lengthContainer.appendChild(createNumberInput(this.params.lengthBars, 0, null, 1, v => this.params.lengthBars = v));
        lengthContainer.appendChild(document.createTextNode("Bar"));
        lengthContainer.appendChild(createNumberInput(this.params.lengthBeats, 0, null, 1, v => this.params.lengthBeats = v));
        createRow("Length (from Playhead):", lengthContainer);

        // Pitch Range
        const pitchOptions = [];
        for (let i = 0; i <= 127; i++) pitchOptions.push({ label: MIDI.getPitchLabel(i), value: i });
        const pitchContainer = document.createElement("div");
        pitchContainer.style.display = "flex";
        pitchContainer.style.gap = "5px";
        pitchContainer.appendChild(createSelect(pitchOptions, this.params.minPitch, v => this.params.minPitch = v));
        pitchContainer.appendChild(document.createTextNode("to"));
        pitchContainer.appendChild(createSelect(pitchOptions, this.params.maxPitch, v => this.params.maxPitch = v));
        createRow("Pitch Range:", pitchContainer);

        // API Params
        createRow("Seed (-1: random):", createNumberInput(this.params.seed, -1, null, 1, v => this.params.seed = v));

        container.appendChild(form);
    }

    private async generate() {
        const track = this.app.tracksController.selectedTrack;
        if (!track) {
            this.app.hostAPI.ui.showToast("Please select a track first.", true);
            return;
        }

        const timeSig = this.app.hostView.metronome.timeSignature || [4, 4];
        const num = timeSig[0];
        const den = timeSig[1];

        const quarterNoteMs = (60 / TEMPO) * 1000;
        const quartersPerBar = num * (4 / den);

        const startMs = this.app.host.playhead;
        const totalQuarters = this.params.lengthBars * quartersPerBar + this.params.lengthBeats;
        const totalDurationMs = totalQuarters * quarterNoteMs;

        if (totalDurationMs <= 0) {
            this.app.hostAPI.ui.showToast("Length must be greater than 0.", true);
            return;
        }

        this.app.hostAPI.ui.showToast("Generating melody via API... Please wait.");

        try {
            // Build request payload
            const requestBody = {
                length_bars: this.params.lengthBars,
                length_beats: this.params.lengthBeats,
                tempo: TEMPO,
                temperature: 1.0, // Hardcoded, unused by backend
                seed: this.params.seed,
                latent_vector_size: 100, // Hardcoded to match wgan_gp.py LATENT_DIM
                min_pitch: this.params.minPitch,
                max_pitch: this.params.maxPitch,
                total_duration_ms: totalDurationMs
            };

            const response = await fetch(this.params.apiEndpoint, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify(requestBody)
            });

            if (!response.ok) {
                throw new Error(`API returned status ${response.status}: ${response.statusText}`);
            }

            const data = await response.json();
            const generatedNotes: { pitch: number, startMs: number, durationMs: number, velocity?: number }[] = data.notes;

            if (!generatedNotes || generatedNotes.length === 0) {
                this.app.hostAPI.ui.showToast("Generation resulted in an empty melody.", true);
                return;
            }

            const regionDuration = totalDurationMs;
            const midi = new MIDI(500, regionDuration);

            generatedNotes.forEach(gene => {
                const velocity = gene.velocity !== undefined ? gene.velocity : 100;
                // Cap note duration to not exceed region
                const dur = Math.min(gene.durationMs, regionDuration - gene.startMs);
                if (dur > 0 && gene.startMs >= 0 && gene.startMs < regionDuration) {
                    midi.putNote(new MIDINote(gene.pitch, velocity, 0, dur), gene.startMs);
                }
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
            this.app.hostAPI.ui.showToast(`Generation complete! Placed ${generatedNotes.length} notes.`);

        } catch (error: any) {
            console.error("API Error:", error);
            this.app.hostAPI.ui.showToast(`Failed to generate: ${error.message}`, true);
        }
    }
}
