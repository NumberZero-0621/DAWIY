import App from "../../App";
import { TEMPO } from "../../Env";
import MIDIRegion from "../../Models/Region/MIDIRegion";
import { MIDINote, MIDI } from "../../Audio/MIDI/MIDI";
import { DAWIYPlugin } from "../IDawiyPlugin";
import DawiyPluginBase from "../DawiyPluginBase";

const SCALES: { [name: string]: number[] } = {
    "None": [],
    "Major": [0, 2, 4, 5, 7, 9, 11],
    "Minor": [0, 2, 3, 5, 7, 8, 10],
    "Harmonic Minor": [0, 2, 3, 5, 7, 8, 11],
    "Pentatonic Major": [0, 2, 4, 7, 9],
    "Pentatonic Minor": [0, 3, 5, 7, 10],
    "Blues": [0, 3, 5, 6, 7, 10],
    "Dorian": [0, 2, 3, 5, 7, 9, 10],
    "Mixolydian": [0, 2, 4, 5, 7, 9, 10]
};

interface Gene {
    pitch: number;
    startMs: number;
    durationMs: number;
}

@DAWIYPlugin
export default class GeneticMelodyGeneratorPlugin extends DawiyPluginBase {
    id = "genetic-melody-generator";
    name = "Genetic Melody Generator";
    description = "Generates melodies using a Genetic Algorithm.";
    group = "Generator";

    // Params
    private params = {
        lengthBars: 4,
        lengthBeats: 0,
        minPitch: 60, // C4
        maxPitch: 84, // C6
        minDuration: "1/16",
        maxDuration: "1/4",
        maxPolyphony: 1,
        scale: "Major",
        jumpTolerance: 5, // semi-tones
        targetRestRatio: 10, // %
        targetDurationVariance: 50, // 0 to 100
        generations: 50,
        populationSize: 50,
        mutationRate: 0.1,
    };

    private durationOptions = [
        { label: "1/64", value: 1 / 64 },
        { label: "1/32", value: 1 / 32 },
        { label: "1/16", value: 1 / 16 },
        { label: "1/8", value: 1 / 8 },
        { label: "1/4", value: 1 / 4 },
        { label: "1/2", value: 1 / 2 },
        { label: "1/1", value: 1 }
    ];

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
        genBtn.textContent = "Generate (Evolve)";
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
        form.style.gridTemplateColumns = "180px 1fr";
        form.style.gap = "8px";
        form.style.alignItems = "center";

        const createRow = (label: string, element: HTMLElement) => {
            const labelEl = document.createElement("div");
            labelEl.textContent = label;
            form.appendChild(labelEl);
            form.appendChild(element);
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

        // Generation Length
        const lengthContainer = document.createElement("div");
        lengthContainer.style.display = "flex";
        lengthContainer.style.gap = "5px";
        lengthContainer.appendChild(createNumberInput(this.params.lengthBars, 0, null, 1, v => this.params.lengthBars = v));
        lengthContainer.appendChild(document.createTextNode("Bar"));
        lengthContainer.appendChild(createNumberInput(this.params.lengthBeats, 0, null, 1, v => this.params.lengthBeats = v));
        lengthContainer.appendChild(document.createTextNode("Beat"));
        createRow("Length (from Playhead):", lengthContainer);

        // Scale
        const scaleOptions = Object.keys(SCALES).map(k => ({ label: k, value: k }));
        createRow("Scale:", createSelect(scaleOptions, this.params.scale, v => this.params.scale = v));

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

        // Duration Range
        const durContainer = document.createElement("div");
        durContainer.style.display = "flex";
        durContainer.style.gap = "5px";
        durContainer.appendChild(createSelect(this.durationOptions.map(o => ({ ...o, value: o.label })), this.params.minDuration, v => this.params.minDuration = v));
        durContainer.appendChild(document.createTextNode("to"));
        durContainer.appendChild(createSelect(this.durationOptions.map(o => ({ ...o, value: o.label })), this.params.maxDuration, v => this.params.maxDuration = v));
        createRow("Note Length:", durContainer);

        // Polyphony
        createRow("Max Polyphony:", createNumberInput(this.params.maxPolyphony, 1, 16, 1, v => this.params.maxPolyphony = v));

        // Fitness Targets
        createRow("Jump Tolerance (st):", createNumberInput(this.params.jumpTolerance, 0, 127, 1, v => this.params.jumpTolerance = v));
        createRow("Target Rest Ratio (%):", createNumberInput(this.params.targetRestRatio, 0, 100, 1, v => this.params.targetRestRatio = v));
        createRow("Note Length Variance:", createNumberInput(this.params.targetDurationVariance, 0, 100, 1, v => this.params.targetDurationVariance = v));

        // GA Params
        const gaContainer = document.createElement("div");
        gaContainer.style.display = "flex";
        gaContainer.style.gap = "5px";
        gaContainer.appendChild(document.createTextNode("Gen:"));
        gaContainer.appendChild(createNumberInput(this.params.generations, 1, 1000, 1, v => this.params.generations = v));
        gaContainer.appendChild(document.createTextNode("Pop:"));
        gaContainer.appendChild(createNumberInput(this.params.populationSize, 2, 1000, 1, v => this.params.populationSize = v));
        gaContainer.appendChild(document.createTextNode("Mut:"));
        gaContainer.appendChild(createNumberInput(this.params.mutationRate, 0, 1, 0.01, v => this.params.mutationRate = v));
        createRow("GA Parameters:", gaContainer);

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

        const parseDuration = (d: string): number => {
            const [n, dmr] = d.split('/').map(Number);
            return (n / dmr) * 4;
        };

        const minDurMs = parseDuration(this.params.minDuration) * quarterNoteMs;
        const maxDurMs = parseDuration(this.params.maxDuration) * quarterNoteMs;

        this.app.hostAPI.ui.showToast("Evolving melody... Please wait.");
        
        // Ensure UI updates before heavy computation
        await new Promise(resolve => setTimeout(resolve, 50));

        const bestIndividual = this.runGeneticAlgorithm(totalDurationMs, minDurMs, maxDurMs);

        if (!bestIndividual || bestIndividual.length === 0) {
            this.app.hostAPI.ui.showToast("Evolution resulted in an empty melody.", true);
            return;
        }

        const regionDuration = totalDurationMs;
        const midi = new MIDI(500, regionDuration);

        bestIndividual.forEach(gene => {
            midi.putNote(new MIDINote(gene.pitch, 100, 0, gene.durationMs), gene.startMs);
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
        this.app.hostAPI.ui.showToast(`Generation complete! Placed ${bestIndividual.length} notes.`);
    }

    private runGeneticAlgorithm(totalDurationMs: number, minDurMs: number, maxDurMs: number): Gene[] {
        let population = this.initializePopulation(totalDurationMs, minDurMs, maxDurMs);

        for (let gen = 0; gen < this.params.generations; gen++) {
            const fitnesses = population.map(ind => this.calculateFitness(ind, totalDurationMs));
            const newPopulation: Gene[][] = [];

            // Elitism: keep best
            const bestIdx = fitnesses.indexOf(Math.max(...fitnesses));
            newPopulation.push(JSON.parse(JSON.stringify(population[bestIdx])));

            while (newPopulation.length < this.params.populationSize) {
                const parentA = this.selectParent(population, fitnesses);
                const parentB = this.selectParent(population, fitnesses);

                let child = this.crossover(parentA, parentB, totalDurationMs);
                child = this.mutate(child, totalDurationMs, minDurMs, maxDurMs);

                newPopulation.push(child);
            }

            population = newPopulation;
        }

        const finalFitnesses = population.map(ind => this.calculateFitness(ind, totalDurationMs));
        const bestIdx = finalFitnesses.indexOf(Math.max(...finalFitnesses));
        return population[bestIdx];
    }

    private initializePopulation(totalDurationMs: number, minDurMs: number, maxDurMs: number): Gene[][] {
        const pop: Gene[][] = [];
        for (let i = 0; i < this.params.populationSize; i++) {
            const individual: Gene[] = [];
            let currentMs = 0;
            
            // Randomly generate notes to fill the duration
            while (currentMs < totalDurationMs) {
                const numNotes = Math.floor(Math.random() * this.params.maxPolyphony) + 1;
                const durMs = minDurMs + Math.random() * (maxDurMs - minDurMs);
                
                if (currentMs + durMs > totalDurationMs) {
                    break;
                }

                // Chance of rest
                if (Math.random() * 100 >= this.params.targetRestRatio) {
                    for (let n = 0; n < numNotes; n++) {
                        const pitch = Math.floor(this.params.minPitch + Math.random() * (this.params.maxPitch - this.params.minPitch + 1));
                        individual.push({ pitch, startMs: currentMs, durationMs: durMs });
                    }
                }
                
                // Jump to next note position (with some potential overlap/gap)
                currentMs += durMs;
            }
            pop.push(individual);
        }
        return pop;
    }

    private selectParent(population: Gene[][], fitnesses: number[]): Gene[] {
        // Tournament selection
        const tournamentSize = 3;
        let bestIdx = -1;
        let bestFit = -Infinity;
        for (let i = 0; i < tournamentSize; i++) {
            const idx = Math.floor(Math.random() * population.length);
            if (fitnesses[idx] > bestFit) {
                bestFit = fitnesses[idx];
                bestIdx = idx;
            }
        }
        if (bestIdx === -1) bestIdx = 0;
        return JSON.parse(JSON.stringify(population[bestIdx]));
    }

    private crossover(parentA: Gene[], parentB: Gene[], totalDurationMs: number): Gene[] {
        // One-point crossover based on time
        const crossoverTime = Math.random() * totalDurationMs;
        const child: Gene[] = [];

        parentA.forEach(gene => {
            if (gene.startMs < crossoverTime) {
                child.push({ ...gene });
            }
        });

        parentB.forEach(gene => {
            if (gene.startMs >= crossoverTime) {
                child.push({ ...gene });
            }
        });

        return child;
    }

    private mutate(individual: Gene[], totalDurationMs: number, minDurMs: number, maxDurMs: number): Gene[] {
        const mutated: Gene[] = [];
        
        individual.forEach(gene => {
            const g = { ...gene };
            if (Math.random() < this.params.mutationRate) {
                // Mutate pitch
                const shift = Math.floor(Math.random() * 13) - 6; // -6 to +6
                g.pitch = Math.max(this.params.minPitch, Math.min(this.params.maxPitch, g.pitch + shift));
            }
            if (Math.random() < this.params.mutationRate) {
                // Mutate duration
                const durShift = (Math.random() - 0.5) * (maxDurMs - minDurMs) * 0.5;
                g.durationMs = Math.max(minDurMs, Math.min(maxDurMs, g.durationMs + durShift));
            }
            if (Math.random() < this.params.mutationRate) {
                // Mutate start time slightly
                const timeShift = (Math.random() - 0.5) * minDurMs;
                g.startMs = Math.max(0, Math.min(totalDurationMs - g.durationMs, g.startMs + timeShift));
            }
            mutated.push(g);
        });

        // Add or remove genes randomly
        if (Math.random() < this.params.mutationRate) {
            if (mutated.length > 0 && Math.random() < 0.5) {
                // Remove a random note
                mutated.splice(Math.floor(Math.random() * mutated.length), 1);
            } else {
                // Add a random note
                const pitch = Math.floor(this.params.minPitch + Math.random() * (this.params.maxPitch - this.params.minPitch + 1));
                const durMs = minDurMs + Math.random() * (maxDurMs - minDurMs);
                const startMs = Math.random() * (totalDurationMs - durMs);
                mutated.push({ pitch, startMs, durationMs: durMs });
            }
        }

        return mutated;
    }

    private calculateFitness(individual: Gene[], totalDurationMs: number): number {
        let fitness = 0;
        if (individual.length === 0) return -1000;

        // Sort by start time for sequence analysis
        const sorted = [...individual].sort((a, b) => a.startMs - b.startMs);

        // 1. Scale Adherence
        const scale = SCALES[this.params.scale];
        if (scale && scale.length > 0) {
            let inScaleCount = 0;
            sorted.forEach(g => {
                const pc = g.pitch % 12;
                if (scale.includes(pc)) inScaleCount++;
            });
            fitness += (inScaleCount / sorted.length) * 100;
        } else {
            // If no scale selected, neutral score
            fitness += 100; 
        }

        // 2. Jump Tolerance
        let jumpPenalty = 0;
        for (let i = 1; i < sorted.length; i++) {
            const prev = sorted[i - 1];
            const curr = sorted[i];
            
            // Only compare notes that are sequential (not same chord)
            if (curr.startMs - prev.startMs > 10) { 
                const jump = Math.abs(curr.pitch - prev.pitch);
                if (jump > this.params.jumpTolerance) {
                    jumpPenalty += (jump - this.params.jumpTolerance) * 2;
                }
            }
        }
        fitness -= jumpPenalty;

        // 3. Polyphony Check
        let maxConcurrent = 0;
        let polyphonyPenalty = 0;
        sorted.forEach(g1 => {
            let concurrent = 0;
            sorted.forEach(g2 => {
                if (g1.startMs >= g2.startMs && g1.startMs < g2.startMs + g2.durationMs) {
                    concurrent++;
                }
            });
            if (concurrent > maxConcurrent) maxConcurrent = concurrent;
        });
        if (maxConcurrent > this.params.maxPolyphony) {
            polyphonyPenalty += (maxConcurrent - this.params.maxPolyphony) * 50;
        }
        fitness -= polyphonyPenalty;

        // 4. Rest Ratio
        let activeTime = 0;
        let currentMaxEnd = 0;
        sorted.forEach(g => {
            if (g.startMs >= currentMaxEnd) {
                activeTime += g.durationMs;
                currentMaxEnd = g.startMs + g.durationMs;
            } else if (g.startMs + g.durationMs > currentMaxEnd) {
                activeTime += (g.startMs + g.durationMs) - currentMaxEnd;
                currentMaxEnd = g.startMs + g.durationMs;
            }
        });
        
        const actualRestRatio = Math.max(0, (totalDurationMs - activeTime) / totalDurationMs) * 100;
        const restDiff = Math.abs(actualRestRatio - this.params.targetRestRatio);
        fitness -= restDiff * 2;

        // 5. Note Length Variance
        const meanDur = sorted.reduce((sum, g) => sum + g.durationMs, 0) / sorted.length;
        const variance = sorted.reduce((sum, g) => sum + Math.pow(g.durationMs - meanDur, 2), 0) / sorted.length;
        const stdDevMs = Math.sqrt(variance);
        
        const quarterMs = (60 / TEMPO) * 1000;
        const normalizedVar = Math.min(100, (stdDevMs / quarterMs) * 50); 
        const varDiff = Math.abs(normalizedVar - this.params.targetDurationVariance);
        fitness -= varDiff;

        // 6. Range bounds penalty
        let oobPenalty = 0;
        sorted.forEach(g => {
            if (g.startMs < 0 || g.startMs + g.durationMs > totalDurationMs) {
                oobPenalty += 10;
            }
        });
        fitness -= oobPenalty;

        return fitness;
    }
}
