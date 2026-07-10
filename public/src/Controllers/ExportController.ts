import { initializeWamHost } from "@webaudiomodules/sdk";
import App from "../App";
import { bufferToWave, downloadBlob, downloadBlobWithPicker, getSaveAudioHandle, writeAudioToHandle, bufferToMp3 } from "../Audio/Utils/audioBufferToWave";
import { PluginInstance } from "../Models/Plugin";
import Track from "../Models/Track/Track";
import { audioCtx } from "../index";
import AutomationController from "./AutomationController";
import { exportToMidi } from "../Audio/MIDI/MIDIExport";
import { invoke } from "@tauri-apps/api/core";

/**
 * Controller class that binds the events of the exporter.
 */
export default class ExporterController {

    /**
     * Route Application.
     */
    _app: App;

    constructor(app: App) {
        this._app = app;
    }

    /**
     * Exports the project to MIDI files.
     *
     * @param masterTrack - If true, it will export all tracks into one MIDI file.
     * @param tracksIds - List of tracks ID to export individually.
     * @param name - Name of the project that will prefix the name of the files.
     */
    public async exportMidi(masterTrack: boolean, tracksIds: number[], name: string): Promise<void> {
        if (!masterTrack && tracksIds.length === 0) return;
        if (name == "") name = "project";

        const midiType = [{
            description: 'MIDI File',
            accept: { 'audio/midi': ['.mid'] }
        }];

        // Export Individual Tracks
        for (let trackId of tracksIds) {
            const track = this._app.tracksController.getTrackById(trackId);
            if (track) {
                // Export single track
                const midiBytes = exportToMidi([track]);
                const blob = new Blob([midiBytes] as any, { type: 'audio/midi' });
                await downloadBlobWithPicker(blob, `${name}_track_${track.element.name}.mid`, midiType);
            }
        }

        // Export Master Track (All Tracks)
        if (masterTrack) {
            const allTracks = [...this._app.tracksController.tracks];
            const midiBytes = exportToMidi(allTracks);
            const blob = new Blob([midiBytes] as any, { type: 'audio/midi' });
            await downloadBlobWithPicker(blob, `${name}_master.mid`, midiType);
        }
    }

    /**
     * Exports the project to audio files. If masterTrack is true, it will export the master track.
     *
     * @param masterTrack - If true, it will export the master track.
     * @param tracksIds - List of tracks ID to export.
     * @param name - Name of the project that will prefix the name of the files.
     */
    public async exportSongs(masterTrack: boolean, tracksIds: number[], name: string): Promise<void> {
        // Check if there are no tracks to export and if so, return early.
        if (!masterTrack && tracksIds.length === 0) {
            return;
        }
        // Set default name if empty.
        if (name == "") name = "project";

        // Check if there's content to export.
        let maxDuration = this._app.regionsController.getMaxDurationRegions(); // in seconds
        if (maxDuration == 0) {
            alert("You can't export nothing...");
            return;
        }

        // PRE-PICK SAVE LOCATION FOR MASTER TRACK (to avoid User Activation expiry)
        let masterHandle = null;
        if (masterTrack && 'showSaveFilePicker' in window) {
            masterHandle = await getSaveAudioHandle(`${name}_master.wav`);
            if (!masterHandle) {
                // User cancelled or error, assume cancel.
                return;
            }
        }

        const exportElement = this._app.projectView.exportElement;
        exportElement.showProgress(0, "Starting export...");

        try {
            let buffers = [];

            const { default: initializeWamHost } = await import("@webaudiomodules/sdk/src/initializeWamHost");

            // Process and export individual tracks.
            for (let i = 0; i < this._app.tracksController.tracks.length; i++) {
                let track = this._app.tracksController.tracks.get(i);
                exportElement.showProgress((i / this._app.tracksController.tracks.length) * 100, `Rendering track ${track.element.name}...`);
                
                // Allow UI update
                await new Promise(r => setTimeout(r, 0));

                let buffer = await this.processTrack(track, maxDuration, initializeWamHost);
                if (buffer) buffers.push(buffer);
                if (tracksIds.includes(track.id)) {
                    exportElement.showProgress(100, `Saving track ${track.element.name}...`);
                    await this.exportTrackBuffer(buffer, `${name}_track_${track.element.name}.wav`);
                }
            }

            // Process and export the master track if requested.
            if (masterTrack) {
                exportElement.showProgress(0, "Rendering Master Track...");
                await this.exportMasterTrack(buffers, name, maxDuration, masterHandle);
            }
        } finally {
            exportElement.hideProgress();
        }
    }

    /**
     * Processes a track and return its audio buffer.
     *
     * @param track - Track to process.
     * @param maxDuration - Maximum duration of the track.
     * @param initializeWamHost - Function to initialize the WAM host.
     *
     * @returns The audio buffer of the track.
     */
    private async processTrack(track: Track, maxDuration: number, initializeWamHost: any): Promise<AudioBuffer> {
        // @ts-ignore
        if (window.__TAURI_INTERNALS__) {
            try {
                let max_duration_samples = Math.ceil(maxDuration * audioCtx.sampleRate);
                let response = await invoke<Uint8Array>("bounce_offline", {
                    maxDurationSamples: max_duration_samples,
                    trackIds: [track.id]
                });
                return this.decodeTauriAudioResponse(response);
            } catch (e) {
                alert("Error bouncing track offline: " + e);
                throw e;
            }
        }

        // Create offline audio context.
        let offlineCtx = new OfflineAudioContext(2, audioCtx.sampleRate * maxDuration, audioCtx.sampleRate)
        const [hostGroupId] = await initializeWamHost(offlineCtx)

        // Recreate the graph in the online audio context.
        const graph=await track.track_graph.instantiate(offlineCtx,hostGroupId)
        graph.connect(offlineCtx.destination)

        // Start source node and render.
        await graph.playEfficiently(0, maxDuration*1000)
        let renderedBuffer = await offlineCtx.startRendering();
        
        // Clean up everything.
        await graph.dispose()

        return renderedBuffer

        /* ALTERNATIVE FOR TEST, OUTPUT TO ONLINE AUDIO CONTEXT */
        /*let offlineCtx = new AudioContext({ sampleRate: audioCtx.sampleRate })
        const [hostGroupId] = await initializeWamHost(offlineCtx)
        const graph=await track.track_graph.instantiate(offlineCtx,hostGroupId)
        graph.connect(offlineCtx.destination)
        console.log("WILL SET PLAYHEADs")
        graph.playhead=0
        console.log("PLAYHEADS sets")
        graph.isPlaying=true
        return new AudioBuffer({length:10, sampleRate:audioCtx.sampleRate, numberOfChannels:2})*/
    }

    /**
     * Processes and export the master track.
     *
     * @param buffers - List of buffers to combine.
     * @param name - Name of the project.
     * @param maxDuration - Maximum duration of the track.
     * @param preSelectedHandle - Optional pre-selected file handle.
     *
     * @returns The audio buffer of the master track.
     */
    private async exportMasterTrack(buffers: AudioBuffer[], name: string, maxDuration: number, preSelectedHandle: any): Promise<void> {
        const exportElement = this._app.projectView.exportElement;
        
        let renderedBuffer: AudioBuffer;

        // @ts-ignore
        if (window.__TAURI_INTERNALS__) {
            try {
                exportElement.showProgress(0, "Rendering Master Track...");
                let max_duration_samples = Math.ceil(maxDuration * audioCtx.sampleRate);
                let response = await invoke<Uint8Array>("bounce_offline", {
                    maxDurationSamples: max_duration_samples,
                    trackIds: null
                });
                renderedBuffer = this.decodeTauriAudioResponse(response);
            } catch (e) {
                alert("Error bouncing master offline: " + e);
                throw e;
            }
        } else {
            // Create offline audio context.
            let offlineCtx = new OfflineAudioContext(2, audioCtx.sampleRate * maxDuration, audioCtx.sampleRate)
            //let offlineCtx = audioCtx
            const { default: initializeWamHost } = await import("@webaudiomodules/sdk/src/initializeWamHost");
            const [hostGroupId] = await initializeWamHost(offlineCtx)

            // Recreate the graph in the online audio context.
            const graph=await this._app.host.host_graph.instantiate(offlineCtx,hostGroupId)
            graph.connect(offlineCtx.destination)
            await new Promise(it=>setTimeout(it,1000))

            // Start source node and render.
            await graph.playEfficiently(0, maxDuration*1000)

            renderedBuffer = await offlineCtx.startRendering();

            // Clean up everything.
            await graph.dispose()
        }
        
        if (preSelectedHandle) {
            exportElement.showProgress(0, `Encoding ${preSelectedHandle.type === 'mp3' ? 'MP3' : 'WAV'}...`);
            await writeAudioToHandle(preSelectedHandle.handle, renderedBuffer, preSelectedHandle.type, (percent) => {
                exportElement.showProgress(percent, `Encoding ${preSelectedHandle.type === 'mp3' ? 'MP3' : 'WAV'} (${Math.round(percent)}%)...`);
            });
        } else {
            // Fallback for browsers without File System API or individual track export (if reused)
            await this.exportTrackBuffer(renderedBuffer, `${name}_master.wav`);
        }
    }

    private decodeTauriAudioResponse(response: any): AudioBuffer {
        try {
            let buffer: ArrayBuffer;
            let byteOffset = 0;
            let byteLength = undefined;
            if (response instanceof ArrayBuffer) {
                buffer = response;
            } else if (response instanceof Uint8Array) {
                buffer = response.buffer;
                byteOffset = response.byteOffset;
                byteLength = response.byteLength;
            } else if (Array.isArray(response)) {
                buffer = new Uint8Array(response).buffer;
            } else {
                throw new Error("Invalid response type from Tauri");
            }

            const dataView = new DataView(buffer, byteOffset, byteLength);
            const numSamples = dataView.getUint32(0, true);
            
            const audioBuffer = audioCtx.createBuffer(2, numSamples, audioCtx.sampleRate);
            const channelL = audioBuffer.getChannelData(0);
            const channelR = audioBuffer.getChannelData(1);
            
            const lOffset = 4;
            const rOffset = 4 + numSamples * 4;
            
            for (let i = 0; i < numSamples; i++) {
                channelL[i] = dataView.getFloat32(lOffset + i * 4, true);
                channelR[i] = dataView.getFloat32(rOffset + i * 4, true);
            }
            return audioBuffer;
        } catch (e) {
            alert("Error in decodeTauriAudioResponse: " + e);
            throw e;
        }
    }

    /**
     * Export a given audio buffer as a WAV file.
     *
     * @param buffer - Audio buffer to export.
     * @param fileName - Name of the file.
     * @private
     */
    private async exportTrackBuffer(buffer: AudioBuffer, fileName: string): Promise<void> {
        // Fallback for individual tracks or when API not supported
        const exportElement = this._app.projectView.exportElement;
        if ('showSaveFilePicker' in window) {
             const handleObj = await getSaveAudioHandle(fileName);
             if (handleObj) {
                 exportElement.showProgress(0, `Encoding ${handleObj.type === 'mp3' ? 'MP3' : 'WAV'}...`);
                 await writeAudioToHandle(handleObj.handle, buffer, handleObj.type, (percent) => {
                     exportElement.showProgress(percent, `Encoding ${handleObj.type === 'mp3' ? 'MP3' : 'WAV'} (${Math.round(percent)}%)...`);
                 });
             }
        } else {
             const blob = bufferToWave(buffer);
             // downloadBlob imports from audioBufferToWave
             const { downloadBlob } = await import("../Audio/Utils/audioBufferToWave");
             downloadBlob(blob, fileName);
        }
    }


    // TODO Find how it is useful, the base track audio graph should work as good
    /**
     * Rebuilds the track graph to export it. It will create a new gain node, panner node and source node.
     * It uses an offline audio context to render the track. It also creates a new plugin instance if the track has one.
     *
     * @param offlineCtx - Offline audio context to render the track.
     * @param track - Track to export.
     * @param hostGroupId - Host group ID.
     * @private
     */
    /*private async rebuildTrackGraph(offlineCtx: OfflineAudioContext, track: RegionTrack, hostGroupId: string) {
        let gainNode = offlineCtx.createGain()
        let pannerNode = offlineCtx.createStereoPanner()
        let sourceNode = offlineCtx.createBufferSource()
        let plugin = new Plugin(this._app)

        sourceNode.buffer = track.audioBuffer as AudioBuffer
        gainNode.gain.value = track.volume
        pannerNode.pan.value = track.balance

        if (track.plugin.initialized) {
            await plugin.initPlugin(this._app.host.pluginWAM, audioCtx, offlineCtx, hostGroupId)
            document.getElementById("loading-zone")!.appendChild(plugin.dom)
            let state = await track.plugin.instance!._audioNode.getState()
            if (state.current.length > 0) {
                await plugin.setStateAsync(state)
            }
        }
        return {gainNode, pannerNode, sourceNode, plugin}
    }*/

    /**
     * Applies the automation to the plugin.
     * TODO: Doesn't work on offline audio context. Must investigate.
     *
     * @param track - Track to export.
     * @param plugin - Plugin to apply the automation.
     * @param offlineAudioContext - Offline audio context to render the track.
     * @private
     */
    private applyAutomation(track:Track, plugin: PluginInstance, offlineAudioContext: OfflineAudioContext) {
        plugin.audioNode.clearEvents();
        let automation = track.automation;
        let events = [];
        for (let bpf of automation.bpfList) {
            let point = bpf.lastPoint;
            if (point == null) {
                continue;
            }
            let list = [];
            for (let x = 0; x < point[0]; x += 0.1) {
                list.push(bpf.getYfromX(x));
            }
            let start = AutomationController.getStartingPoint(point[0]*1000, 0, list.length);
            let paramID = bpf.paramID;
            let t = 0;
            for (let i = start; i < list.length; i++) {
                events.push({ type: 'wam-automation', data: { id: paramID, value: list[i] }, time: offlineAudioContext.currentTime + t })
                t += 0.1;
            }
        }
        events.sort((a, b) => a.time - b.time);
        // @ts-ignore
        plugin.instance?._audioNode.scheduleEvents(...events);
    }
}