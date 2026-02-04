import { parseMidiFile } from "../../Audio/MIDI/MIDIImport";
import App, { crashOnDebug } from "../../App";
import { MIDI } from "../../Audio/MIDI/MIDI";
import { parseNoteList } from "../../Audio/MIDI/MIDILoaders";
import OperableAudioBuffer from "../../Audio/OperableAudioBuffer";
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
    static DRAG_LOADERS: ((start: number, file: ArrayBuffer, type: string) => Promise<RegionOf<any> | null>)[] = [
        // Load MIDI files through note list
        async function (start, buffer, type) {
            const midi = await parseNoteList(buffer)
            if (midi) return new MIDIRegion(midi, start)
            else return null
        },
        // Load MIDI files
        async function (start, buffer, type) {
            if (!["audio/mid"].includes(type)) return null
            const midi = await MIDI.load2(buffer)
            if (midi) return new MIDIRegion(midi, start)
            else return null
        },
        // Load sample files
        async function (start, buffer, type) {
            if (!["audio/mpeg", "audio/ogg", "audio/wav", "audio/x-wav"].includes(type)) return null
            try {
                let audioArrayBuffer = buffer
                let audioBuffer = await audioCtx.decodeAudioData(audioArrayBuffer);
                let operableAudioBuffer = OperableAudioBuffer.make(audioBuffer);
                return new SampleRegion(operableAudioBuffer, start)
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

        // Handle drop on the canvas/window
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
                const hasFiles = Array.from(e.dataTransfer.items).some(item => item.kind === 'file');
                if (hasFiles) {
                    this.importDraggedFiles([...e.dataTransfer.items], e.clientX, e.clientY);
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
                        const audioFile = item.file
                        if (!audioFile) return null
                        target.track.element.name = audioFile.name
                        return { buffer: await audioFile.arrayBuffer(), type: item.type }
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
                return { buffer: await file.arrayBuffer(), type: file.headers.get("content-type") || "" }
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

        if ((clientX >= offsetLeft && clientX <= offsetLeft + this._view.width) &&
            (clientY >= offsetTop && clientY <= offsetTop + this._view.height)) {

            // Get the start location
            const start = (this._app.editorView.viewport.left + (clientX - offsetLeft)) * RATIO_MILLS_BY_PX;

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
        return null
    }

    /**
     * Import a file as a region in a track at a given position.
     * @param bufferLoader The function that loads the file, returning the file content as an arraybuffer and the file type
     * @param track The track to import the file in
     * @param start The start position of the loaded region
     */
    private async importFile(bufferLoader: () => Promise<{ buffer: ArrayBuffer, type: string } | null>, track: Track, start: number): Promise<RegionOf<any> | null> {
        this._view.setLoading(true)
        track.element.progress();

        // Fetch the file
        const file = await bufferLoader()
        if (!file) {
            this._view.setLoading(false)
            console.error("File could not be loaded")
            return null
        }

        // Get the array buff
        const { buffer, type } = file

        // Decode the audio file as a node
        let region: RegionOf<any> | null = null
        for (const loader of EditorController.DRAG_LOADERS) {
            // Try each audio file loader until one can decode the file
            let loaded_region = await loader(start, buffer, type)
            if (loaded_region !== null) {
                region = loaded_region
                this._app.regionsController.addRegion(track, loaded_region)
                break
            }
        }
        track.element.progressDone();
        this._view.setLoading(false)
        return region
    }

}