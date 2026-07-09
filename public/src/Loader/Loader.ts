import App from "../App";
import { MIDI } from "../Audio/MIDI/MIDI";
import OperableAudioBuffer from "../Audio/OperableAudioBuffer";
import { State } from "../Components/BPF";
import { MAX_DURATION_SEC } from "../Env";
import AutomationRegion, { AutomationPoint } from "../Models/Region/AutomationRegion";
import MIDIRegion from "../Models/Region/MIDIRegion";
import { RegionOf, RegionType } from "../Models/Region/Region";
import SampleRegion from "../Models/Region/SampleRegion";
import Track from "../Models/Track/Track";
import { invoke } from "@tauri-apps/api/core";
import RustAudioBuffer from "../Audio/RustAudioBuffer";
import { audioCtx } from "../index";


/**
 * The current project version.
 * A project with a greater version number is not compatible.
 * A project with a different major version number is not compatible.
 * Increment the major version number when the project format changes in a way that is not backward compatible.
 * Increment the minor version number when the project format changes in a way that is backward but not forward compatible.
 */
const CURRENT_PROJECT_VERSION: [number, number] = [1, 0]

/** Loaders to load regions. */
const regionLoaders: {
    [key: RegionType<any>]: {
        loader: (buffer: ArrayBuffer | string) => Promise<RegionOf<any>>,
        extension: string,
    }
} = {
    [MIDIRegion.TYPE]: {
        loader: async buffer => new MIDIRegion(await MIDI.load(buffer as ArrayBuffer), 0),
        extension: "wamstudiomidi",
    },
    [SampleRegion.TYPE]: {
        loader: async buffer => {
            if ((window as any).__TAURI__) {
                const { invoke } = await import('@tauri-apps/api/core');
                let tempPath: string;
                if (typeof buffer === "string") {
                    tempPath = buffer;
                } else {
                    let formData = new FormData();
                    formData.append("file", new Blob([buffer as any]));
                    let uploadRes = await fetch("http://localhost:6002/upload_temp", { method: "POST", body: formData });
                    if (!uploadRes.ok) throw new Error(`Upload failed: ${uploadRes.status}`);
                    tempPath = (await uploadRes.json()).path;
                }

                const bufferId = OperableAudioBuffer.getNewId();
                const info: any = await invoke('load_audio_file', {
                    bufferId: bufferId,
                    path: tempPath
                });
                let rustBuffer = new RustAudioBuffer(
                    info.buffer_id,
                    info.length,
                    info.sample_rate,
                    info.channels,
                    info.peaks,
                    tempPath
                );
                return new SampleRegion(rustBuffer, 0);
            } else {
                const audioBuffer = await audioCtx.decodeAudioData(buffer as ArrayBuffer);
                const opAudioBuffer = OperableAudioBuffer.make(audioBuffer);
                return new SampleRegion(opAudioBuffer, 0)
            }
        },
        extension: "wav",
    },
}


/** The project data format. */
export interface ProjectData {
    version: [major: number, minor: number];
    host: {
        playhead: number;
        tempo: number,
        time_signature: [number, number],
        volume: number;
        plugin?: {
            name: string;
            state: any;
            url?: string;
        };
        pluginArray?: {
            name: string;
            state: any;
            url?: string;
        }[];
        // Plugins project data (ID -> Data)
        plugins?: { [id: string]: any };
    }
    tracks: {
        name: string;
        muted: boolean;
        solo: boolean;
        balance: number;
        volume: number;
        color: string;
        plugin?: {
            name: string;
            state: any;
            url?: string;
        };
        pluginArray?: {
            name: string;
            state: any;
            url?: string;
        }[];
        automationOpened?: boolean;
        currentAutomationParam?: string;
        currentAutomationParams?: string[];
        automations: {
            param: string;
            points: AutomationPoint[];
            color?: string;
        }[];
        regions: {
            type: string;
            content_name: string;
            start: number;
            native_path?: string;
        }[]
    }[];
}

/**
 * The region content format.
 * Separated from the project data to allow loading regions asynchronously.
 */
export interface RegionContent {
    content_name: string;
    blob: Blob;
}

export default class Loader {
    _app: App;

    constructor(app: App) {
        this._app = app;
    }

    /**
     * Save the current project.
     * @returns The current project data.
     */
    async saveProject(): Promise<[ProjectData, RegionContent[]]> {

        // Get host plugins state
        let hostPluginArray: { name: string, state: any, url?: string }[] = [];
        for (const p of this._app.host.plugins) {
            const state = await p.getState();
            // WAM_LISTからURL情報を取得（VSTプラグインの復元に必要）
            const wamInfo = this._app.pluginsController.WAM_LIST[p.name];
            hostPluginArray.push({ name: p.name, state, url: wamInfo?.url });
        }
        let pluginHostState = hostPluginArray.length > 0 ? hostPluginArray[0] : undefined;
        const pluginsData = this._app.dawiyPluginController.getPluginsProjectData();


        // Save the tracks
        let contents: RegionContent[] = [];
        let tracks: ProjectData['tracks'] = [];
        for (let track of this._app.tracksController.tracks) {
            // Add automations to the track
            let automations: ProjectData['tracks'][0]['automations'] = [];
            let pluginArray: { name: string, state: any, url?: string }[] = [];
            for (const p of track.plugins) {
                const state = await p.getState();
                // WAM_LISTからURL情報を取得（VSTプラグインの復元に必要）
                const wamInfo = this._app.pluginsController.WAM_LIST[p.name];
                pluginArray.push({ name: p.name, state, url: wamInfo?.url });
            }
            let pluginData = pluginArray.length > 0 ? pluginArray[0] : undefined;

            // Save Automation Data
            // 1. Current Regions (Active Lanes)
            for (const region of track.automationRegions) {
                if (region.paramId) {
                    track.automationData.set(region.paramId, region.points);
                }
            }

            // 2. Iterate all data in map
            for (const [paramId, points] of track.automationData) {
                if (points && points.length > 0) {
                    automations.push({
                        param: paramId,
                        points: points,
                        color: track.automationColors.get(paramId)
                    });
                }
            }

            // Add regions to the track
            let regions: ProjectData['tracks'][0]['regions'] = [];
            for (let region of track.regions) {
                // Skip AutomationRegion in normal region list if we don't want to save it as a "Region" blob
                // But wait, the original logic checks regionLoaders. 
                // We haven't added AutomationRegion to regionLoaders.
                // So it will likely be skipped or error if we don't handle it.
                // Automation is saved in 'automations' property now.
                // So we explicitly skip it here.
                if (region.regionType === "AUTOMATION_REGION") continue;

                let content_name = `track-${track.id}-region-${region.id}`

                const extension = regionLoaders[region.regionType]?.extension
                if (extension) content_name += `.${extension}`
                else continue; // Skip unknown regions

                let native_path: string | undefined = undefined;
                if ((window as any).__TAURI__ && region.regionType === "SAMPLE") {
                    let sampleRegion = region as any; // Cast to access buffer
                    if (sampleRegion.buffer && sampleRegion.buffer.nativePath) {
                        native_path = sampleRegion.buffer.nativePath;
                    }
                }

                if (native_path) {
                    try {
                        const { invoke } = await import('@tauri-apps/api/core');
                        const bytes = await invoke('read_file_bytes', { path: native_path }) as Uint8Array;
                        contents.push({
                            content_name,
                            blob: new Blob([bytes.buffer as ArrayBuffer])
                        });
                    } catch (e) {
                        console.error("Failed to read native file", e);
                        contents.push({ content_name, blob: new Blob([]) });
                    }
                } else {
                    contents.push({
                        content_name,
                        blob: region.save()
                    });
                }

                regions.push({
                    content_name,
                    type: region.regionType,
                    start: region.start,
                    native_path: native_path
                });
            }

            tracks.push({
                name: track.element.name,
                color: track.color,
                muted: track.isMuted,
                solo: track.isSolo,
                volume: track.volume,
                balance: track.balance,
                plugin: pluginData,
                pluginArray: pluginArray,
                regions: regions,
                automations: automations,
                automationOpened: track.isAutomationOpened,
                currentAutomationParam: track.automationRegions.length > 0 ? track.automationRegions[0].paramId : undefined,
                currentAutomationParams: track.automationRegions.map(r => r.paramId).filter((id): id is string => !!id)
            });
        }

        let project: ProjectData = {
            version: CURRENT_PROJECT_VERSION,
            host: {
                playhead: this._app.host.playhead,
                tempo: this._app.hostView.tempoSelector.tempo,
                time_signature: this._app.hostView.timeSignatureSelector.timeSignature,
                volume: this._app.host.volume,
                plugin: pluginHostState,
                pluginArray: hostPluginArray,
                plugins: pluginsData
            },
            tracks: tracks
        }
        console.log("Save Project:", project, contents)
        return [project, contents]
    }

    async loadProject(data: ProjectData, contents: (id: string) => XMLHttpRequest) {
        this._app.editorView.setLoading(true)
        let project: ProjectData = data;
        console.log("Load Project:", project)

        // Version check
        {
            let error_message = null
            let version = project.version;
            if (!Array.isArray(version) || version.length != 2) error_message = `The project version(${version}) is invalid, the project incompatible`
            else if (version[0] < CURRENT_PROJECT_VERSION[0]) error_message = `The project version(${version.join(".")}) is too old`
            else if (version[0] > CURRENT_PROJECT_VERSION[0]) error_message = `The project version(${version.join(".")}) is too recent. Use a more recent version WAMStudio`
            else if (version[1] > CURRENT_PROJECT_VERSION[1]) error_message = `The project version(${version.join(".")}) is too recent. Use a more recent version WAMStudio`
            if (error_message != null) {
                alert(`${error_message}. WAM Studio version: ${CURRENT_PROJECT_VERSION.join(".")}`)
                return
            }
        }

        let tracksJson = project.tracks
        this._app.hostController.stopAllTracks()
        this._app.tracksController.clearTracks()
        this._app.host.playhead = 0
        this._app.host.volume = project.host.volume
        this._app.hostView.tempoSelector.tempo = project.host.tempo
        this._app.hostView.timeSignatureSelector.timeSignature = project.host.time_signature

        // Restore Host Plugins
        // NOTE: project.host.plugins is used for DAWIY extensions data. The rack is in pluginArray.
        const hDataArray = (project.host as any).pluginArray || (project.host.plugin ? [project.host.plugin] : []);
        for (const pData of hDataArray) {
            // VSTプラグインの場合、まずWAM_LISTに再登録する
            if (pData.url && pData.url.startsWith("vst://")) {
                this._app.pluginsController.addWam(pData.url, pData.name);
            }
            const plugin = await this._app.pluginsController.fetchPlugin(pData.name)
            if (plugin) {
                const inst = await this._app.host.addPlugin(plugin);
                if (inst) {
                    try {
                        // VSTの場合、vstPathは既にdefault_stateで設定済みなので除外
                        const stateToRestore = pData.url?.startsWith("vst://") && pData.state?.vstPath
                            ? { ...pData.state, vstPath: undefined }
                            : pData.state;
                        await Promise.race([
                            inst.setState(stateToRestore),
                            new Promise((_, reject) => setTimeout(() => reject(new Error("State load timeout")), 5000))
                        ]);
                    } catch (e) {
                        console.error(`Failed to load state for host plugin ${pData.name}`, e);
                    }
                }
            }
        }

        if (project.host.plugins) {
            this._app.dawiyPluginController.setPluginsProjectData(project.host.plugins);
        }

        // Load tracks
        for (const trackJson of tracksJson) {
            let track = await this._app.tracksController.createTrack();

            track.element.name = trackJson.name
            track.element.trackNameInput.value = trackJson.name

            track.isMuted = trackJson.muted
            track.isSolo = trackJson.solo
            track.balance = trackJson.balance
            track.volume = trackJson.volume
            this._app.tracksController.setColor(track, trackJson.color)

            const pDataArray = trackJson.pluginArray || (trackJson.plugin ? [trackJson.plugin] : []);
            for (const pData of pDataArray) {
                // VSTプラグインの場合、まずWAM_LISTに再登録する
                if (pData.url && pData.url.startsWith("vst://")) {
                    this._app.pluginsController.addWam(pData.url, pData.name);
                }
                const plugin = await this._app.pluginsController.fetchPlugin(pData.name)
                if (plugin) {
                    const inst = await track.addPlugin(plugin);
                    if (inst) {
                        try {
                            // VSTの場合、vstPathは既にdefault_stateで設定済みなので除外
                            const stateToRestore = pData.url?.startsWith("vst://") && pData.state?.vstPath
                                ? { ...pData.state, vstPath: undefined }
                                : pData.state;
                            await Promise.race([
                                inst.setState(stateToRestore),
                                new Promise((_, reject) => setTimeout(() => reject(new Error("State load timeout")), 5000))
                            ]);
                        } catch (e) {
                            console.error(`Failed to load state for track plugin ${pData.name}`, e);
                        }
                    }
                }
            }
            if (pDataArray.length > 0) {
                await this._app.automationController.updateAutomations(track);
            }
            // Load Automations
            let automations = trackJson.automations;
            if (automations) {
                for (let automation of automations) {
                    if (automation.points && automation.points.length > 0) {
                        track.automationData.set(automation.param, automation.points);
                        if (automation.color) {
                            track.automationColors.set(automation.param, automation.color);
                        }
                    }
                }
            }

            // Restore Automation UI State
            if (trackJson.automationOpened) {
                track.isAutomationOpened = true;
                const paramsToOpen = trackJson.currentAutomationParams || (trackJson.currentAutomationParam ? [trackJson.currentAutomationParam] : []);

                if (paramsToOpen.length > 0) {
                    for (const paramId of paramsToOpen) {
                        await this._app.automationController.addAutomationLane(track, paramId);
                    }
                } else {
                    // Default open (volume only etc)
                    await this._app.automationController.addAutomationLane(track);
                }
            }

            let regions = trackJson.regions;
            this.loadTrackRegions(track, regions, contents);
        }

        this._app.editorView.setLoading(false)

    }

    loadTrackRegions(track: Track, regions: ProjectData['tracks'][0]['regions'], contents: (id: string) => XMLHttpRequest) {
        let loadedRegions = 0;
        let totalSize = new Map<XMLHttpRequest, number>();
        let loadedSize = new Map<XMLHttpRequest, number>();

        const checkCompletion = () => {
            loadedRegions++;
            if (loadedRegions === regions.length) {
                track.element.progressDone();
            }
        }

        for (let region of regions) {
            const decoder = regionLoaders[region.type]?.loader
            if (!decoder) {
                checkCompletion();
                continue;
            }

            if ((window as any).__TAURI__ && region.native_path) {
                // Native path loading bypasses XHR and blob loading
                (async () => {
                    try {
                        const { invoke } = await import('@tauri-apps/api/core');
                        const OperableAudioBuffer = (await import('../Audio/OperableAudioBuffer')).default;
                        const RustAudioBuffer = (await import('../Audio/RustAudioBuffer')).default;
                        const SampleRegion = (await import('../Models/Region/SampleRegion')).default;
                        
                        const bufferId = OperableAudioBuffer.getNewId();
                        const info: any = await invoke('load_audio_file', {
                            bufferId: bufferId,
                            path: region.native_path
                        });
                        
                        let rustBuffer = new RustAudioBuffer(
                            info.buffer_id,
                            info.length,
                            info.sample_rate,
                            info.channels,
                            info.peaks,
                            region.native_path
                        );
                        let newRegion = new SampleRegion(rustBuffer, region.start);
                        
                        if (!track.deleted) {
                            this._app.regionsController.addRegion(track, newRegion);
                        }
                    } catch (e) {
                        console.error('Failed to load native audio via Rust:', e);
                    }
                    checkCompletion();
                })();
                continue;
            }

            let xhr = contents(region.content_name)
            xhr.responseType = "arraybuffer"

            // Loading
            xhr.onprogress = (event) => {
                if (event.lengthComputable) {
                    totalSize.set(xhr, event.total);
                    loadedSize.set(xhr, event.loaded);

                    let totalSizeSum = Array.from(totalSize.values()).reduce((a, b) => a + b, 0);
                    let totalLoadedSum = Array.from(loadedSize.values()).reduce((a, b) => a + b, 0);

                    if (track.deleted) {
                        xhr.abort();
                        return;
                    }

                    track.element.progress(totalLoadedSum, totalSizeSum);
                }
            };

            // Finish Loading
            xhr.onload = async () => {
                if (xhr.status == 200) {
                    let audioArrayBuffer = xhr.response as ArrayBuffer
                    try {
                        let newRegion = await decoder(audioArrayBuffer)
                        if (track.deleted) {
                            return; // Abort/return but don't checkCompletion as we are "deleted"
                        }

                        newRegion.start = region.start;
                        this._app.regionsController.addRegion(track, newRegion);
                    } catch (e) {
                        console.error("Failed to decode region", e);
                    }
                } else {
                    // For empty blobs from localstorage where status is not 200, or blob is missing
                    console.error('An error occurred fetching the track region:', xhr.statusText);
                }
                checkCompletion();
            };

            xhr.onerror = () => {
                console.error('An error occurred fetching the track region');
                checkCompletion();
            };

            try {
                xhr.send();
            } catch (e) {
                console.error("Failed to send XHR", e);
                checkCompletion();
            }
        }
    }

    async loadTrackUrl(track: Track, url: string) {
        console.log("Load Track via Rust: " + url);
        try {
            const bufferId = OperableAudioBuffer.getNewId();
            const info: any = await invoke('load_audio_file', {
                bufferId: bufferId,
                path: url
            });
            
            if (track.deleted) return;
            
            // Create RustAudioBuffer with returned info
            let rustBuffer = new RustAudioBuffer(
                info.buffer_id,
                info.length,
                info.sample_rate,
                info.channels,
                info.peaks
            );
            
            this._app.regionsController.addRegion(track, new SampleRegion(rustBuffer, 0));
            track.element.progressDone();
        } catch (e) {
            console.error('An error occurred loading track via Rust:', e);
            track.element.progressDone();
        }
    }
}