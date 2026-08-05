import { parseMidiFile } from "../../Audio/MIDI/MIDIImport";
import App, { crashOnDebug } from "../../App";
import { MIDI } from "../../Audio/MIDI/MIDI";
import { parseNoteList } from "../../Audio/MIDI/MIDILoaders";
import OperableAudioBuffer from "../../Audio/OperableAudioBuffer";
import RustAudioBuffer from "../../Audio/RustAudioBuffer";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { MAX_ZOOM_LEVEL, MIN_ZOOM_LEVEL, RATIO_MILLS_BY_PX, ZOOM_LEVEL, setZoomLevel } from "../../Env";
import MIDIRegion from "../../Models/Region/MIDIRegion";
import { RegionOf } from "../../Models/Region/Region";
import SampleRegion from "../../Models/Region/SampleRegion";
import Track from "../../Models/Track/Track";
import { isKeyPressed } from "../../Utils/keys";
import EditorView from "../../Views/Editor/EditorView";
import { audioCtx } from "../../index";

/**
 * Interface of the custom event of the ScrollBarElement.
 */
export interface ScrollEvent extends Event {
    detail?: {
        value: number,
        type: string
    }
}

/**
 * Controller class that binds the events of the editor. It controls the zoom and the render of the editor.
 */
export default class EditorController {

    /**
     * The file loaders used to load dragged files.
     * It should return the loaded region or null if the file is not supported.
     */
    static DRAG_LOADERS: ((start: number, file: ArrayBuffer | string, type: string, onProgressCallback?: (message: any) => void, name?: string) => Promise<RegionOf<any> | null>)[] = [
        // Load MIDI files through note list
        async function (start, buffer, type, onProgressCallback, name) {
            if (typeof buffer === "string") return null;
            const midi = await parseNoteList(buffer)
            if (midi) return new MIDIRegion(midi, start)
            else return null
        },
        // Load MIDI files
        async function (start, buffer, type, onProgressCallback, name) {
            if (typeof buffer === "string") return null;
            if (!["audio/mid"].includes(type) && !name?.toLowerCase().endsWith(".mid") && !name?.toLowerCase().endsWith(".midi")) return null
            const midi = await MIDI.load2(buffer)
            if (midi) return new MIDIRegion(midi, start)
            else return null
        },
        // Load sample files
        async function (start, buffer, type, onProgressCallback, name) {
            const ext = name?.split('.').pop()?.toLowerCase();
            const isValidExt = ["wav", "mp3", "ogg", "flac", "m4a", "aac"].includes(ext || "");
            const isValidType = ["audio/mpeg", "audio/ogg", "audio/wav", "audio/x-wav", "audio/mp3", "audio/flac", "audio/aac", "audio/m4a"].includes(type);
            
            if (!isValidExt && !isValidType) return null;
            try {
                if (typeof buffer === "string") {
                    const { invoke, Channel } = await import('@tauri-apps/api/core');
                    const RustAudioBuffer = (await import('../../Audio/RustAudioBuffer')).default;
                    const bufferId = OperableAudioBuffer.getNewId();
                    
                    const onProgress = new Channel<any>();
                    onProgress.onmessage = (message) => {
                        if (onProgressCallback) onProgressCallback(message);
                    };

                    const info: any = await invoke('load_audio_file', {
                        bufferId: bufferId,
                        path: buffer,
                        onProgress: onProgress
                    });
                    let rustBuffer = new RustAudioBuffer(
                        info.buffer_id, info.length, info.sample_rate, info.channels, info.peaks, buffer
                    );
                    return new SampleRegion(rustBuffer, start);
                } else {
                    let audioArrayBuffer = buffer as ArrayBuffer;

                    if ((window as any).__TAURI__) {
                        const { invoke, Channel } = await import('@tauri-apps/api/core');
                        const RustAudioBuffer = (await import('../../Audio/RustAudioBuffer')).default;
                        const bufferId = OperableAudioBuffer.getNewId();
                        
                        const onProgress = new Channel<any>();
                        onProgress.onmessage = (message) => {
                            if (onProgressCallback) onProgressCallback(message);
                        };

                        // To bypass Tauri v2 IPC JSON serialization freeze for large Uint8Array,
                        // upload the raw bytes to the local backend server (bank) and pass the path to Rust.
                        let formData = new FormData();
                        formData.append("file", new Blob([audioArrayBuffer]));
                        let uploadRes = await fetch("http://localhost:6002/upload_temp", { method: "POST", body: formData });
                        if (!uploadRes.ok) throw new Error(`Upload failed: ${uploadRes.status}`);
                        let tempPath = (await uploadRes.json()).path;

                        const info: any = await invoke('load_audio_file', {
                            bufferId: bufferId,
                            path: tempPath,
                            onProgress: onProgress
                        });
                        let rustBuffer = new RustAudioBuffer(
                            info.buffer_id, info.length, info.sample_rate, info.channels, info.peaks, tempPath
                        );
                        return new SampleRegion(rustBuffer, start);
                    } else {
                        let audioBuffer = await audioCtx.decodeAudioData(audioArrayBuffer);
                        let operableAudioBuffer = OperableAudioBuffer.make(audioBuffer);
                        return new SampleRegion(operableAudioBuffer, start);
                    }
                }
            } catch (e) {
                console.error(e)
                return null
            }
        },
    ]

    /** Route Application. */
    private _app: App;

    /** View of the editor. */
    private _view: EditorView;

    /** Pointer to the current zoom level. */
    private _currentLevel = 5;

    /** Last zoom level executed. */
    private _lastExecutedZoom = 0

    /** Number of zoom steps. */
    private readonly ZOOM_STEPS = 12;

    /** Last zoom level executed. */
    private readonly THROTTLE_TIME = 10;

    constructor(app: App) {
        this._view = app.editorView;
        this._app = app;

        this.bindEvents();
        this.bindSnapEvents();
    }

    private bindSnapEvents() {
        const hostView = this._app.hostView;

        hostView.snapBtnArrow.addEventListener("click", (e) => {
            const display = hostView.snapMenu.style.display;
            hostView.snapMenu.style.display = display === "none" ? "block" : "none";
            e.stopPropagation();
        });

        const updateViews = () => {
            this._view.grid.updateGrid();
            this._app.pianoRollController.redraw();
        };

        const setSnap = (res: number) => {
            this._view.snapResolution = res;
            hostView.updateSnapMenu(this._view.snapResolution, this._view.snapTriplet);
            updateViews();
        };

        hostView.snap1_1.addEventListener("click", () => setSnap(1));
        hostView.snap1_2.addEventListener("click", () => setSnap(2));
        hostView.snap1_4.addEventListener("click", () => setSnap(4));
        hostView.snap1_8.addEventListener("click", () => setSnap(8));
        hostView.snap1_16.addEventListener("click", () => setSnap(16));
        hostView.snap1_32.addEventListener("click", () => setSnap(32));

        hostView.snapTriplet.addEventListener("click", (e) => {
            this._view.snapTriplet = !this._view.snapTriplet;
            hostView.updateSnapMenu(this._view.snapResolution, this._view.snapTriplet);
            updateViews();
            e.stopPropagation();
        });

        document.addEventListener("click", (e) => {
            if (hostView.snapMenu.style.display === "block") {
                hostView.snapMenu.style.display = "none";
            }
        });

        // Initial update
        hostView.updateSnapMenu(this._view.snapResolution, this._view.snapTriplet);
    }

    public async zoomTo(new_zoom_level: number, respect_step: boolean = false): Promise<void> {
        // Snap to 1.0 if crossing
        if ((ZOOM_LEVEL < 1 && new_zoom_level > 1) || (ZOOM_LEVEL > 1 && new_zoom_level < 1)) {
            new_zoom_level = 1;
        }

        // Get zoom center
        const [zoomTarget, zoomTargetPos] = (() => {
            const viewportLeft = this._view.playhead.viewportLeft * RATIO_MILLS_BY_PX
            const viewportRight = viewportLeft + this._view.playhead.viewportWidth * RATIO_MILLS_BY_PX
            const viewportWidth = viewportRight - viewportLeft
            const playhead = this._app.host.playhead
            if (viewportLeft <= playhead && playhead <= viewportRight) return [playhead, (playhead - viewportLeft) / viewportWidth]
            else return [(viewportLeft + viewportRight) / 2, 0.5]
        })()

        // Init
        for (const button of [this._app.hostView.zoomInBtn, this._app.hostView.zoomOutBtn]) {
            button.classList.add("zoom-disabled")
            button.classList.remove("zoom-enabled")
        }

        // Get zoom ratio
        new_zoom_level = Math.max(MIN_ZOOM_LEVEL, Math.min(new_zoom_level, MAX_ZOOM_LEVEL))
        if (respect_step) {
            const current_step = this.getStepByZoom(RATIO_MILLS_BY_PX)
            let new_step = this.getStepByZoom(new_zoom_level)
            new_zoom_level = this.getZoomByStep(new_step)
        }

        // Zoom
        const oldRatio = RATIO_MILLS_BY_PX;
        setZoomLevel(new_zoom_level)
        const newRatio = RATIO_MILLS_BY_PX;

        this._app.playheadController.updateRangeAfterZoom(oldRatio, newRatio);
        this._app.pianoRollController.updateRangeAfterZoom(oldRatio, newRatio);

        this._app.host.playhead = this._app.host.playhead
        this._view.playhead.viewportLeft = (zoomTarget / RATIO_MILLS_BY_PX) - this._view.playhead.viewportWidth * zoomTargetPos
        await this._view.resizeCanvas()
        this._view.loop.updatePositionFromTime(...this._app.hostController.loopRange)
        this._app.automationController.updateBPFWidth()
        this._view.spanZoomLevel.value = ZOOM_LEVEL.toFixed(2)
        await Promise.all(this._app.tracksController.tracks.map(track => this._view.stretchRegions(track)))

        // Force immediate redraw to avoid debounce delay
        this._app.tracksController.tracks.forEach(track => {
            track.regions.forEach(region => {
                this._app.regionsController.updateRegionView(region as RegionOf<any>);
            });
        });

        // Refresh Piano Roll if open
        this._app.pianoRollController.redraw();

        if (ZOOM_LEVEL != MAX_ZOOM_LEVEL) {
            this._app.hostView.zoomInBtn.classList.add("zoom-enabled")
            this._app.hostView.zoomInBtn.classList.remove("zoom-disabled")
        }

        if (ZOOM_LEVEL != MIN_ZOOM_LEVEL) {
            this._app.hostView.zoomOutBtn.classList.add("zoom-enabled")
            this._app.hostView.zoomOutBtn.classList.remove("zoom-disabled")
        }
    }


    /**
     * Defines the drag and drop functionality for the editor.
     * It adds the dropped files to the track _view.
     */
    private bindEvents(): void {
        window.addEventListener("resize", () => {
            this._view.resizeCanvas();
        });
        this._view.editorDiv.addEventListener("wheel", (e) => {
            if (this._app.pianoRollController.isVisible) return;
            console.log("wheel called !!!!")
            // MB: Prevent the default scroll behavior (i.e., browser swipe navigation)
            e.preventDefault();

            // Idéalement :
            // Avec souris : scroll vertical avec la molette et zoom sur control + molette
            // avec pad ou surface : scroll horizontal avec deux doigts et
            // scroll vertical avec deux doigts et control pour zoom
            // ou gesture multi pinch out et in pour zoom

            if (isKeyPressed("Shift")) { // Zoom in/out
                const currentTime = Date.now();
                if (currentTime - this._lastExecutedZoom < this.THROTTLE_TIME) return;

                this._lastExecutedZoom = currentTime;

                const isMac = navigator.platform.toUpperCase().includes('MAC');
                if (isMac && e.metaKey || !isMac && e.ctrlKey) {
                    const zoomIn = e.deltaY > 0;
                    if (zoomIn) this._app.editorController.zoomTo(ZOOM_LEVEL * 1.5);
                    else this._app.editorController.zoomTo(ZOOM_LEVEL / 1.5);
                }
                else {
                    this._view.handleWheel(e);
                }
            }
            else { // Scroll
                //console.log("Detected horizontal scroll with two fingers");
                // console.log("Horizontal scroll distance: ", e.deltaX);
                // console.log("Vertical scroll distance: ", e.deltaY);

                // MB changed e.deltaY to e.deltaX
                this._view.playhead.viewportLeft += this._view.playhead.viewportWidth * e.deltaX / 2000

                // Scroll vertically
                this._view.verticalScrollbar.customScrollBy(e.deltaY);
            }


            e.stopPropagation();
        });
        this._view.horizontalScrollbar.addEventListener("change", (e: ScrollEvent) => {
            this._view.handleHorizontalScroll(e);
        });
        this._view.verticalScrollbar.addEventListener("change", (e: ScrollEvent) => {
            this._view.handleVerticalScroll(e);
        });
        // Use capture phase for dragover to ensure we allow copy everywhere in the window
        window.addEventListener('dragover', (e: DragEvent) => {
            e.preventDefault();
            if (e.dataTransfer) {
                e.dataTransfer.dropEffect = "copy";
            }
        }, true);

        window.addEventListener('dragenter', (e: DragEvent) => {
            e.preventDefault();
            if (e.dataTransfer) {
                e.dataTransfer.dropEffect = "copy";
            }
        }, true);
        
        // Listen to Tauri file drop event (Provides absolute paths for OS files)
        if ((window as any).__TAURI__ || (window as any).__TAURI_INTERNALS__) {
            getCurrentWindow().onDragDropEvent(async (event: any) => {
                if (event.payload.type === 'drop') {
                    const paths = event.payload.paths;
                    const pos = event.payload.position;
                    if (!pos) return;

                    console.log("[EditorController] Tauri file drop:", paths, pos);

                    // Need clientX/clientY for getTrackAt. Tauri position is PhysicalPosition or LogicalPosition
                    // Depending on dpi, let's assume it maps to clientX/clientY for now.
                    // Convert Tauri's PhysicalPosition to logical coordinates used by CSS
                    let clientX = pos.x / window.devicePixelRatio;
                    let clientY = pos.y / window.devicePixelRatio;

                    let needNewTrack = false;
                    const target = await this.getTrackAt(clientX, clientY, true);
                    if (!target) return;

                    let success = false;
                    for (const path of paths) {
                        if (needNewTrack) {
                            const tracks = this._app.tracksController.tracks;
                            let next_track = tracks.get(tracks.indexOf(target.track) + 1);
                            if (next_track == null) {
                                next_track = await this._app.tracksController.createTrack();
                            }
                            target.track = next_track;
                            needNewTrack = false;
                        }

                        // Check if it's midi
                        if (path.toLowerCase().endsWith('.mid') || path.toLowerCase().endsWith('.midi')) {
                            // MIDI still handled by JS since it doesn't need huge buffers
                            // But since we only have path, we can't easily read the ArrayBuffer unless we use tauri-plugin-fs!
                            // For now, custom MIDI drop might require fs. Let's ignore MIDI via Tauri path for a moment,
                            // actually we should handle audio here:
                        } else if (path.toLowerCase().match(/\.(wav|mp3|ogg|flac|m4a|aac)$/i)) {
                            target.track.element.progress(0, 1);
                            try {
                                const { invoke, Channel } = await import('@tauri-apps/api/core');
                                const bufferId = OperableAudioBuffer.getNewId();
                                
                                const onProgress = new Channel<any>();
                                onProgress.onmessage = (message) => {
                                    target.track.element.progress(message.loaded, message.total);
                                };

                                const info: any = await invoke('load_audio_file', {
                                    bufferId: bufferId,
                                    path: path,
                                    onProgress: onProgress
                                });
                                let rustBuffer = new RustAudioBuffer(
                                    info.buffer_id, info.length, info.sample_rate, info.channels, info.peaks, path
                                );

                                target.track.element.name = path.split(/[\\/]/).pop() || "Audio Track";
                                this._app.regionsController.addRegion(target.track, new SampleRegion(rustBuffer, target.start));
                                success = true;
                                needNewTrack = true;
                            } catch (e) {
                                console.error('Failed to load dropped audio via Rust:', e);
                                this._app.showToast(`Import failed: ${e}`, true);
                            }
                            target.track.element.progressDone();
                        }
                    }
                    if (!success && !needNewTrack) target.cancel();
                }
            });
        };

        // Handle drop on the canvas/window (Used for Internal drag & drop, and non-audio files handled by web API)
        window.addEventListener('drop', (e: DragEvent) => {
            e.preventDefault();
            e.stopPropagation(); // Stop default browser behavior

            console.log("Global drop event caught!", e.clientX, e.clientY);

            // Check for audioFileURL (internal drag from Audio Loop Browser)
            if (e.dataTransfer?.getData("audioFileURL")) {
                let audioFileURL = e.dataTransfer?.getData("audioFileURL");
                console.log("Importing audio loop from URL:", audioFileURL);
                this.importDraggedAudioLoop(audioFileURL, e.clientX, e.clientY);
            }
            // Check for external files (OS file drag)
            else if (e.dataTransfer?.items && e.dataTransfer.items.length > 0) {
                const items = Array.from(e.dataTransfer.items);

                // Check for custom importers first
                // If ANY file matches a custom importer, we hand it over to the importer 
                // and skip the default audio/midi loading for that file.
                // However, EditorController is designed to load files into TRACKS.
                // Custom importers might do something else (like load into a plugin UI).

                // We will collect items that are NOT handled by custom importers 
                // and pass them to importDraggedFiles.

                const itemsForTracks: DataTransferItem[] = [];

                // Filter out items because Tauri `onFileDropEvent` handles local files!
                // We only handle non-file items (like dragged text/URLs) OR custom web imports here.
                for (const item of items) {
                    const file = item.getAsFile();
                    if (file) {
                        const ext = "." + file.name.split('.').pop()?.toLowerCase();
                        const importer = this._app.hostAPI.getImporter(ext);

                        if (importer) {
                            console.log(`[EditorController] Found custom importer for ${file.name}`);
                            importer(file).catch(err => {
                                console.error(`[EditorController] Custom import failed:`, err);
                                this._app.showToast(`Import failed: ${err}`, true);
                            });
                            continue; // Handled by custom importer
                        }
                    }
                    itemsForTracks.push(item);
                }

                if (itemsForTracks.length > 0) {
                    this.importDraggedFiles(itemsForTracks, e.clientX, e.clientY);
                }
            }
        }, true); // Capture phase

        this._view.playhead.onViewMove.add((prev, next) => {
            this._view.horizontalScrollbar.scrollLeft = next
            this._view.automationContainer.scrollLeft = next
        })
    }

    /**
     * Given the level, returns the ratio px / ms. The steps are logarithmic. More the level is high, more the steps are
     * large.
     *
     * @param level - The current level to determines the corresponding ratio.
     * @return the ratio of pixels by milliseconds.
     */
    private getZoomByStep(level: number): number {
        return Math.max(MIN_ZOOM_LEVEL, Math.min(MAX_ZOOM_LEVEL, Math.pow(2, level)))
    }

    /**
     * @return Get the zoom level step the nearest of a given zoom level
     */
    private getStepByZoom(zoom_level: number): number {
        return Math.round(Math.log2(zoom_level))
    }


    /**
     * Import files that has been dragged on the page.
     * 
     * @param file - Files that must be dragged
     * @param clientX - x pos of the drop
     * @param clientY - y pos of the drop
     */
    private async importDraggedFiles(_items: DataTransferItem[], clientX: number, clientY: number) {
        // /!\ The file have to be getted before the first "await" /!\
        // The DataTransferItem is emptied, once out of the event listener, if a listener of drop event
        // call this function, you have to get the files before the first await.
        const items = _items.map(f => ({ type: f.type, file: f.getAsFile() }))

        // Get the track under the given position
        const target = await this.getTrackAt(clientX, clientY, true)
        if (!target) return

        // Then import the loaded files
        let success = false
        let needNewTrack = false
        for (const item of items) {
            if (needNewTrack) {
                const tracks = this._app.tracksController.tracks
                let next_track = tracks.get(tracks.indexOf(target.track) + 1)
                if (next_track == null) {
                    next_track = await this._app.tracksController.createTrack()
                }
                target.track = next_track
                needNewTrack = false
            }

            const isMidi = item.type === "audio/midi" || item.type === "audio/x-midi" || (item.file && (item.file.name.endsWith(".mid") || item.file.name.endsWith(".midi")));

            if (isMidi) {
                const audioFile = item.file;
                if (!audioFile) continue;

                target.track.element.progress(0, 1);
                const buffer = await audioFile.arrayBuffer();
                const importedTracks = await parseMidiFile(buffer);
                target.track.element.progressDone();

                if (importedTracks.length > 0) {
                    success = true;
                    let firstTrack = true;
                    for (const imported of importedTracks) {
                        if (!firstTrack) {
                            const tracks = this._app.tracksController.tracks;
                            let nextTrackIndex = tracks.indexOf(target.track) + 1;
                            let nextTrack = tracks.get(nextTrackIndex);
                            if (!nextTrack) {
                                nextTrack = await this._app.tracksController.createTrack();
                            }
                            target.track = nextTrack;
                        }

                        target.track.element.name = imported.name || audioFile.name;
                        const region = new MIDIRegion(imported.midi, target.start);
                        this._app.regionsController.addRegion(target.track, region);
                        firstTrack = false;
                    }
                    needNewTrack = true; // For the next file in `items`
                }
            } else {
                const result = await this.importFile(
                    async () => {
                        const audioFile = item.file as File & { path?: string }
                        if (!audioFile) return null
                        target.track.element.name = audioFile.name
                        if ((window as any).__TAURI__ && audioFile.path) {
                            return { buffer: audioFile.path, type: item.type, name: audioFile.name }
                        }
                        return { buffer: await audioFile.arrayBuffer(), type: item.type, name: audioFile.name }
                    },
                    target.track,
                    target.start
                )
                if (result) {
                    success = true
                    needNewTrack = true
                }
            }
        }
        if (!success) target.cancel()
    }


    private async importDraggedAudioLoop(url: string, clientX: number, clientY: number) {
        // Get the track under the given position
        const target = await this.getTrackAt(clientX, clientY, true)
        if (!target) return

        // Then import the loaded file 
        const result = await this.importFile(
            async () => {
                let file = await fetch(url, { mode: "cors" });
                return { buffer: await file.arrayBuffer(), type: file.headers.get("content-type") || "", name: url.split('/').pop() || "" }
            },
            target.track,
            target.start
        )
        if (!result) target.cancel()
    }

    /**
     * Get the track at the given position (or create it if doCreate is true).
     * Return null if there is no track at the given position if doCreate is not set to true
     * or if the track can't be created at the given position.
     * @param clientX The x position
     * @param clientY The y position
     * @param doCreate If true, create a new track if no track is found at the given position
     * @returns The track at the given position and the position of the given position in the track as duration in milliseconds.
     * And a function you can call to cancel the creation of the track if a track has been created.
     */
    private async getTrackAt(clientX: number, clientY: number, doCreate = false): Promise<{ start: number, track: Track, cancel: () => void } | null> {
        let offsetLeft = this._view.canvasContainer.offsetLeft // offset x of the canvas
        let offsetTop = this._view.canvasContainer.offsetTop // offset y of the canvas

        let start = 0;
        if (clientX >= offsetLeft) {
            start = (this._app.editorView.viewport.left + (clientX - offsetLeft)) * RATIO_MILLS_BY_PX;
        }

        // Check if the position is on an existing track
        let waveform = this._view.getWaveformAtPos(clientY - offsetTop);

        // Else create the track if asked to
        if (!waveform) {
            if (doCreate) {
                const track = await this._app.tracksController.createTrack();
                track.element.name = "NEW TRACK"
                return { start, track, cancel: () => this._app.tracksController.removeTrack(track) }
            }
            else return null
        }
        else {
            const track = this._app.tracksController.getTrackById(waveform.trackId)!;
            if (track) return { start, track, cancel: () => { } }
            else {
                crashOnDebug("A track should be associated to this waveform")
                return null
            }
        }
    }

    /**
     * Import a file as a region in a track at a given position.
     * @param fileProvider The function that loads the file, returning the file content as an arraybuffer and the file type
     * @param track The track to import the file in
     * @param start The start position of the loaded region
     */
    private async importFile(
        fileProvider: () => Promise<{ buffer: ArrayBuffer | string, type: string, name?: string } | null>,
        track: Track,
        start: number
    ): Promise<RegionOf<any> | null> {
        if (this._app.host.isPlaying) {
            this._app.hostController.stop();
        }
        
        this._view.setLoading(true)
        track.element.progress();

        const fileData = await fileProvider()
        if (!fileData) {
            this._view.setLoading(false)
            console.error("File could not be loaded")
            return null
        }

        // Get the array buff
        const { buffer, type, name } = fileData

        // Decode the audio file as a node
        let region: RegionOf<any> | null = null
        for (const loader of EditorController.DRAG_LOADERS) {
            region = await loader(start, buffer, type, (message: any) => {
                if (message.total) track.element.progress(message.loaded, message.total)
            }, name)
            if (region) break;
        }

        if (region) {
            // Add the region to the track
            this._app.regionsController.addRegion(track, region);
            if (this._app.pianoRollController.isVisible) {
                this._app.pianoRollController.redraw();
            }
            this._view.setLoading(false)
            track.element.progressDone();
            return region
        } else {
            this._view.setLoading(false)
            track.element.progressDone();
            console.error("File could not be loaded")
            return null
        }
    }

}