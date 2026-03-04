import App from "../App";
import JSZip from "jszip";
import Track from "../Models/Track/Track";
import MIDIRegion from "../Models/Region/MIDIRegion";
import SampleRegion from "../Models/Region/SampleRegion";
import { MIDI, MIDINote } from "../Audio/MIDI/MIDI";
import OperableAudioBuffer from "../Audio/OperableAudioBuffer";
import { audioCtx } from "../index";
import { setTempo } from "../Env";

export default class DawProjectLoader {
    private _app: App;
    private _zip: JSZip;
    private _tracksMap: Map<string, Track> = new Map();
    private _tempo: number = 120;

    constructor(app: App) {
        this._app = app;
    }

    public async load(zip: JSZip): Promise<void> {
        this._zip = zip;
        const projectXmlStr = await zip.file("project.xml")?.async("string");
        if (!projectXmlStr) {
            throw new Error("project.xml not found in .dawproject file");
        }

        const parser = new DOMParser();
        const doc = parser.parseFromString(projectXmlStr, "application/xml");

        this._app.editorView.setLoading(true);
        try {
            await this.parseProject(doc);
        } finally {
            this._app.editorView.setLoading(false);
        }
    }

    private async parseProject(doc: Document): Promise<void> {
        // 1. Clear current project
        this._app.hostController.stopAllTracks();
        this._app.tracksController.clearTracks();

        // 2. Parse Transport (Tempo, Time Signature)
        const transport = doc.querySelector("Transport");
        if (transport) {
            const tempoEl = transport.querySelector("Tempo");
            if (tempoEl) {
                this._tempo = parseFloat(tempoEl.getAttribute("value") || "120");
                this._app.hostView.tempoSelector.tempo = this._tempo;
                setTempo(this._tempo);
            }
            const timeSigEl = transport.querySelector("TimeSignature");
            if (timeSigEl) {
                const num = parseInt(timeSigEl.getAttribute("numerator") || "4");
                const den = parseInt(timeSigEl.getAttribute("denominator") || "4");
                this._app.hostView.timeSignatureSelector.timeSignature = [num, den];
                this._app.editorView.grid.updateTimeSignature(num, den);
            }
        }

        // 3. Parse Structure (Tracks)
        const structure = doc.querySelector("Structure");
        if (structure) {
            const tracks = structure.querySelectorAll("Track");
            for (const trackEl of Array.from(tracks)) {
                const id = trackEl.getAttribute("id");
                const name = trackEl.getAttribute("name") || "Track";
                const color = trackEl.getAttribute("color") || "#ff0000";

                const track = await this._app.tracksController.createTrack();
                track.element.name = name;
                track.element.trackNameInput.value = name;
                this._app.tracksController.setColor(track, color);

                if (id) this._tracksMap.set(id, track);

                // Load Plugins
                const channelEl = trackEl.querySelector("Channel");
                if (channelEl) {
                    const pluginsEl = channelEl.querySelector("Plugins");
                    if (pluginsEl) {
                        for (const pluginEl of Array.from(pluginsEl.children)) {
                            const pName = pluginEl.getAttribute("name");
                            const pUrl = pluginEl.getAttribute("url");
                            const stateFile = pluginEl.getAttribute("stateFile");

                            if (pName && pUrl) {
                                // Register WAM if it's not registered
                                if (!this._app.pluginsController.WAM_LIST[pName]) {
                                    this._app.pluginsController.addWam(pUrl, pName);
                                }

                                // Fetch and add plugin
                                const plugin = await this._app.pluginsController.fetchPlugin(pName);
                                if (plugin) {
                                    const instance = await track.addPlugin(plugin);

                                    // Restore state
                                    if (stateFile && instance) {
                                        const zipFile = this._zip.file(stateFile);
                                        if (zipFile) {
                                            const stateStr = await zipFile.async("string");
                                            try {
                                                const state = JSON.parse(stateStr);
                                                await instance.setState(state);
                                            } catch (e) {
                                                console.error("Failed to parse or set plugin state", e);
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        // 4. Parse Arrangement (Clips/Notes/Audio)
        const arrangement = doc.querySelector("Arrangement");
        if (arrangement) {
            const rootLanes = arrangement.querySelector("Lanes");
            if (rootLanes) {
                await this.parseLanes(rootLanes);
            }
        }
    }

    private async parseLanes(lanesEl: Element, parentTimeUnit: string = "beats", parentTrack: Track | null = null): Promise<void> {
        const timeUnit = lanesEl.getAttribute("timeUnit") || parentTimeUnit;
        const trackId = lanesEl.getAttribute("track");
        const track = trackId ? this._tracksMap.get(trackId) : parentTrack;

        // Process children
        for (const child of Array.from(lanesEl.children)) {
            if (child.tagName === "Lanes") {
                await this.parseLanes(child, timeUnit, track as Track);
            } else if (child.tagName === "Clips") {
                if (track) {
                    await this.parseClips(child, track as Track, timeUnit);
                }
            } else if (child.tagName === "Notes") {
                if (track) {
                    const midiRegion = await this.parseNotes(child, 0, timeUnit);
                    if (midiRegion) {
                        this._app.regionsController.addRegion(track as Track, midiRegion);
                    }
                }
            }
        }
    }

    private async parseClips(clipsEl: Element, track: Track, parentTimeUnit: string): Promise<void> {
        // <Clips> element might define its own timeUnit, otherwise inherit
        const clipsTimeUnit = clipsEl.getAttribute("timeUnit") || parentTimeUnit;

        for (const clipEl of Array.from(clipsEl.children)) {
            if (clipEl.tagName === "Clip") {
                const time = parseFloat(clipEl.getAttribute("time") || "0");
                const duration = parseFloat(clipEl.getAttribute("duration") || "0");
                const startTimeMs = this.convertToMs(time, clipsTimeUnit);
                const durationMs = this.convertToMs(duration, clipsTimeUnit);

                // Content uses contentTimeUnit if specified, otherwise inherits from parent (Clips timeline)
                const contentTimeUnit = clipEl.getAttribute("contentTimeUnit") || clipsTimeUnit;

                // Check for content. The order matters to avoid duplicates.
                const warpsEl = clipEl.querySelector("Warps");
                let audioLoaded = false;

                if (warpsEl) {
                    const internalAudioEl = warpsEl.querySelector("Audio");
                    if (internalAudioEl) {
                        const sampleRegion = await this.parseAudio(internalAudioEl, startTimeMs);
                        if (sampleRegion) {
                            this._app.regionsController.addRegion(track, sampleRegion);
                            audioLoaded = true;
                        }
                    }
                }

                // Only check for a direct <Audio> element if not already loaded via <Warps>
                if (!audioLoaded) {
                    const audioEl = clipEl.querySelector("Audio");
                    if (audioEl) {
                        const sampleRegion = await this.parseAudio(audioEl, startTimeMs);
                        if (sampleRegion) {
                            this._app.regionsController.addRegion(track, sampleRegion);
                        }
                    }
                }

                const notesEl = clipEl.querySelector("Notes");
                if (notesEl) {
                    const midiRegion = await this.parseNotes(notesEl, startTimeMs, contentTimeUnit);
                    if (midiRegion) {
                        // Ensure region duration covers the clip duration if longer
                        if (midiRegion.midi.duration < durationMs) {
                            midiRegion.midi.duration = durationMs;
                        }
                        this._app.regionsController.addRegion(track, midiRegion);
                    }
                }
            }
        }
    }

    private async parseNotes(notesEl: Element, startTimeMs: number, timeUnit: string): Promise<MIDIRegion> {
        const notes = notesEl.querySelectorAll("Note");

        // 1. Collect notes and calculate required duration
        const notesData: { key: number, vel: number, channel: number, start: number, duration: number }[] = [];
        let maxEnd = 0;

        for (const noteEl of Array.from(notes)) {
            const time = parseFloat(noteEl.getAttribute("time") || "0");
            const duration = parseFloat(noteEl.getAttribute("duration") || "0");
            const key = parseInt(noteEl.getAttribute("key") || "60");
            const vel = parseFloat(noteEl.getAttribute("vel") || "0.8");
            const channel = parseInt(noteEl.getAttribute("channel") || "0");

            const startMs = this.convertToMs(time, timeUnit);
            const durMs = this.convertToMs(duration, timeUnit);

            notesData.push({ key, vel, channel, start: startMs, duration: durMs });

            if (startMs + durMs > maxEnd) maxEnd = startMs + durMs;
        }

        // 2. Initialize MIDI with correct duration
        // Use a small instant duration (e.g. 16ms) but ensure total duration covers all notes
        const midi = new MIDI(16, maxEnd > 0 ? maxEnd : 1000);

        // 3. Add notes
        for (const n of notesData) {
            const note = new MIDINote(n.key, n.vel, n.channel, n.duration);
            midi.putNote(note, n.start);
        }

        return new MIDIRegion(midi, startTimeMs);
    }

    private async parseAudio(audioEl: Element, startTimeMs: number): Promise<SampleRegion | null> {
        const fileEl = audioEl.querySelector("File");
        if (!fileEl) return null;

        const path = fileEl.getAttribute("path");
        if (!path) return null;

        const zipFile = this._zip.file(path);
        if (!zipFile) {
            console.warn(`Audio file not found in ZIP: ${path}`);
            return null;
        }

        const buffer = await zipFile.async("arraybuffer");
        const audioBuffer = await audioCtx.decodeAudioData(buffer);
        const operableAudioBuffer = OperableAudioBuffer.make(audioBuffer).makeStereo();

        return new SampleRegion(operableAudioBuffer, startTimeMs);
    }

    private convertToMs(value: number, unit: string): number {
        if (unit === "seconds") {
            return value * 1000;
        } else {
            // beats
            return (value * 60 / this._tempo) * 1000;
        }
    }
}
