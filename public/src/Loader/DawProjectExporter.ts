import App from "../App";
import JSZip from "jszip";
import { TEMPO } from "../Env";
import MIDIRegion from "../Models/Region/MIDIRegion";
import SampleRegion from "../Models/Region/SampleRegion";
import { saveAs } from 'file-saver';

export default class DawProjectExporter {
    private _app: App;
    private _zip: JSZip;
    private _xmlDoc: Document;
    private _audioFileCounter: number = 0;
    private _pluginStates: { filename: string, data: string }[] = [];

    constructor(app: App) {
        this._app = app;
        this._zip = new JSZip();
        this._xmlDoc = document.implementation.createDocument(null, "Project", null);
    }

    public async export(): Promise<void> {
        this._app.editorView.setLoading(true);
        try {
            await this.buildProjectXml();
            this.buildMetadataXml();

            await this.addAudioFiles();
            this.addPluginStates();

            const projectXmlStr = new XMLSerializer().serializeToString(this._xmlDoc);
            this._zip.file("project.xml", projectXmlStr);

            const content = await this._zip.generateAsync({ type: "blob" });

            if ('showSaveFilePicker' in window) {
                try {
                    const handle = await (window as any).showSaveFilePicker({
                        suggestedName: "project.dawproject",
                        types: [{
                            description: 'DAWProject File',
                            accept: { 'application/zip': ['.dawproject'] }
                        }],
                    });
                    const writable = await handle.createWritable();
                    await writable.write(content);
                    await writable.close();
                } catch (err: any) {
                    if (err.name !== 'AbortError') {
                        throw err;
                    }
                }
            } else {
                saveAs(content, "project.dawproject");
            }
        } catch (e) {
            console.error("Failed to export dawproject", e);
            alert("Failed to export project.");
        } finally {
            this._app.editorView.setLoading(false);
        }
    }

    private buildMetadataXml() {
        const doc = document.implementation.createDocument(null, "MetaData", null);
        const root = doc.documentElement;

        const title = doc.createElement("Title");
        title.textContent = "WAM-Studio Project"; // Could add a project title input later
        root.appendChild(title);

        const application = doc.createElement("Application");
        application.textContent = "WAM-Studio";
        root.appendChild(application);

        const xmlStr = new XMLSerializer().serializeToString(doc);
        this._zip.file("metadata.xml", xmlStr);
    }

    private async buildProjectXml() {
        const root = this._xmlDoc.documentElement;
        root.setAttribute("version", "1.0");

        // Application
        const appEl = this._xmlDoc.createElement("Application");
        appEl.setAttribute("name", "WAM-Studio");
        appEl.setAttribute("version", "1.0.0");
        root.appendChild(appEl);

        // Transport
        const transport = this._xmlDoc.createElement("Transport");
        const tempo = this._xmlDoc.createElement("Tempo");
        tempo.setAttribute("value", TEMPO.toString());
        tempo.setAttribute("unit", "bpm");
        transport.appendChild(tempo);

        const timeSig = this._xmlDoc.createElement("TimeSignature");
        const [num, den] = this._app.hostView.metronome.timeSignature || [4, 4];
        timeSig.setAttribute("numerator", num.toString());
        timeSig.setAttribute("denominator", den.toString());
        transport.appendChild(timeSig);
        root.appendChild(transport);

        // Structure (Tracks)
        const structure = this._xmlDoc.createElement("Structure");
        const tracks = this._app.tracksController.tracks;

        for (const track of tracks) {
            const trackEl = this._xmlDoc.createElement("Track");
            trackEl.setAttribute("id", `track-${track.id}`);
            trackEl.setAttribute("name", track.element.name);
            if (track.color) trackEl.setAttribute("color", track.color);
            trackEl.setAttribute("loaded", "true");
            // Set contentType based on regions content, or generic "notes audio"
            // For now, let's look at regions
            let hasMidi = false;
            let hasAudio = false;
            track.regions.forEach(r => {
                if (r instanceof MIDIRegion) hasMidi = true;
                if (r instanceof SampleRegion) hasAudio = true;
            });
            const contentTypes = [];
            if (hasMidi) contentTypes.push("notes");
            if (hasAudio) contentTypes.push("audio");
            if (contentTypes.length > 0) trackEl.setAttribute("contentType", contentTypes.join(" "));

            const channelEl = this._xmlDoc.createElement("Channel");
            channelEl.setAttribute("audioChannels", "2");
            channelEl.setAttribute("role", "regular");

            const volumeEl = this._xmlDoc.createElement("Volume");
            volumeEl.setAttribute("value", track.volume.toString());
            volumeEl.setAttribute("unit", "linear");
            channelEl.appendChild(volumeEl);

            const panEl = this._xmlDoc.createElement("Pan");
            const normPan = (track.balance + 1) / 2;
            panEl.setAttribute("value", normPan.toString());
            panEl.setAttribute("unit", "normalized");
            channelEl.appendChild(panEl);

            // Add Plugins
            const pluginsEl = this._xmlDoc.createElement("Plugins");
            for (const pluginInstance of track.plugins) {
                const pluginEl = this._xmlDoc.createElement("Plugin");
                pluginEl.setAttribute("name", pluginInstance.name);

                // Get URL from PluginsController
                const pluginInfo = this._app.pluginsController.WAM_LIST[pluginInstance.name];
                if (pluginInfo && pluginInfo.url) {
                    pluginEl.setAttribute("url", pluginInfo.url);
                }

                // Get state
                const state = await pluginInstance.getState();
                if (state) {
                    const stateStr = JSON.stringify(state);
                    const stateFilename = `plugins/track-${track.id}-plugin-${pluginInstance.instance.instanceId}-state.json`;
                    pluginEl.setAttribute("stateFile", stateFilename);

                    this._pluginStates.push({ filename: stateFilename, data: stateStr });
                }

                pluginsEl.appendChild(pluginEl);
            }
            channelEl.appendChild(pluginsEl);

            trackEl.appendChild(channelEl);
            structure.appendChild(trackEl);
        } // CHANGED to for-of from forEach because of await
        root.appendChild(structure);

        // Arrangement
        const arrangement = this._xmlDoc.createElement("Arrangement");
        const lanes = this._xmlDoc.createElement("Lanes");
        lanes.setAttribute("timeUnit", "beats");

        tracks.forEach(track => {
            const trackLanes = this._xmlDoc.createElement("Lanes");
            trackLanes.setAttribute("track", `track-${track.id}`);

            const clips = this._xmlDoc.createElement("Clips");

            track.regions.forEach(region => {
                const clipEl = this._xmlDoc.createElement("Clip");

                // Convert start/duration from ms to beats
                const startBeats = this.msToBeats(region.start);
                const durationBeats = this.msToBeats(region.duration);

                clipEl.setAttribute("time", startBeats.toFixed(6));
                clipEl.setAttribute("duration", durationBeats.toFixed(6));
                clipEl.setAttribute("playStart", "0");

                if (region instanceof MIDIRegion) {
                    const notesEl = this._xmlDoc.createElement("Notes");
                    region.midi.forEachNote((note, start) => {
                        const noteEl = this._xmlDoc.createElement("Note");
                        noteEl.setAttribute("time", this.msToBeats(start).toFixed(6));
                        noteEl.setAttribute("duration", this.msToBeats(note.duration).toFixed(6));
                        noteEl.setAttribute("key", note.note.toString());
                        noteEl.setAttribute("vel", note.velocity.toFixed(6));
                        noteEl.setAttribute("channel", note.channel.toString());
                        notesEl.appendChild(noteEl);
                    });
                    clipEl.appendChild(notesEl);
                } else if (region instanceof SampleRegion) {
                    const clipsContainerEl = this._xmlDoc.createElement("Clips");

                    const innerClipEl = this._xmlDoc.createElement("Clip");
                    innerClipEl.setAttribute("time", "0"); // Relative to outer clip
                    innerClipEl.setAttribute("duration", durationBeats.toFixed(6));
                    innerClipEl.setAttribute("playStart", "0");
                    innerClipEl.setAttribute("contentTimeUnit", "beats");

                    // Create Warps structure for Audio
                    const warpsEl = this._xmlDoc.createElement("Warps");
                    warpsEl.setAttribute("timeUnit", "beats");
                    warpsEl.setAttribute("contentTimeUnit", "seconds");

                    const audioEl = this._xmlDoc.createElement("Audio");
                    const filename = `audio/track-${track.id}-region-${region.id}.wav`;
                    const durationSec = region.duration / 1000;
                    audioEl.setAttribute("duration", durationSec.toFixed(6));
                    audioEl.setAttribute("sampleRate", "44100");
                    audioEl.setAttribute("channels", "2");

                    const fileEl = this._xmlDoc.createElement("File");
                    fileEl.setAttribute("path", filename);
                    fileEl.setAttribute("external", "false");
                    audioEl.appendChild(fileEl);

                    warpsEl.appendChild(audioEl);

                    // Add Warp points to map beats to seconds
                    const warpStart = this._xmlDoc.createElement("Warp");
                    warpStart.setAttribute("time", "0");
                    warpStart.setAttribute("contentTime", "0");
                    warpsEl.appendChild(warpStart);

                    const warpEnd = this._xmlDoc.createElement("Warp");
                    warpEnd.setAttribute("time", durationBeats.toFixed(6));
                    warpEnd.setAttribute("contentTime", durationSec.toFixed(6));
                    warpsEl.appendChild(warpEnd);

                    innerClipEl.appendChild(warpsEl);
                    clipsContainerEl.appendChild(innerClipEl);
                    clipEl.appendChild(clipsContainerEl);
                }

                clips.appendChild(clipEl);
            });

            trackLanes.appendChild(clips);
            lanes.appendChild(trackLanes);
        });

        arrangement.appendChild(lanes);
        root.appendChild(arrangement);
    }

    private async addAudioFiles() {
        const tracks = this._app.tracksController.tracks;
        // Ensure the folder exists
        const audioFolder = this._zip.folder("audio");
        if (!audioFolder) {
            console.error("Failed to create audio folder in zip");
            return;
        }

        for (const track of tracks) {
            for (const region of track.regions) {
                if (region instanceof SampleRegion) {
                    const blob = region.save(); // returns wav blob
                    const filename = `track-${track.id}-region-${region.id}.wav`;
                    audioFolder.file(filename, blob);
                }
            }
        }
    }

    private addPluginStates() {
        const pluginsFolder = this._zip.folder("plugins");
        if (!pluginsFolder) {
            console.error("Failed to create plugins folder in zip");
            return;
        }

        for (const state of this._pluginStates) {
            // state.filename already includes 'plugins/' prefix, but we can just use the base name inside the folder
            const baseName = state.filename.replace("plugins/", "");
            pluginsFolder.file(baseName, state.data);
        }
    }

    private msToBeats(ms: number): number {
        return (ms / 1000) * (TEMPO / 60);
    }
}
