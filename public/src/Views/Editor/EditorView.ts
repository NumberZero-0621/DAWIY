import { Viewport } from "pixi-viewport";
import { Application, Graphics } from "pixi.js";
import App from "../../App";
import ScrollBarElement from "../../Components/ScrollBarElement";
import { ScrollEvent } from "../../Controllers/Editor/EditorController";
import {
    HEIGHT_NEW_TRACK,
    HEIGHT_TRACK,
    HEIGHT_AUTOMATION,
    MAX_DURATION_SEC,
    RATIO_MILLS_BY_PX,
    TEMPO
} from "../../Env";
import Track from "../../Models/Track/Track";
import GridView from "./GridView";
import LoopView from "./LoopView";
import PlayheadView from "./PlayheadView";
import WaveformView from "./WaveformView";

/**
 * Class that Override PIXI.Application. Represents the main editor and handle all events about the editor.
 * Use to store the waveforms and the playhead.
 */
export default class EditorView extends Application {

    /**
     * Accessors from the index.html
     */
    public canvasContainer = document.getElementById("editor-canvas") as HTMLDivElement;
    public editorDiv = document.getElementById("editor") as HTMLDivElement;
    public horizontalScrollbar = document.getElementById("horizontal-scrollbar") as ScrollBarElement;
    public verticalScrollbar = document.getElementById("vertical-scrollbar") as ScrollBarElement;
    public trackContainer = document.getElementById("track-container") as HTMLDivElement;
    public automationContainer = document.getElementById("automation-container") as HTMLElement;
    public spanZoomLevel = document.getElementById("spanZoomLevel") as HTMLInputElement;
    /**
     * The width of the editor in pixels. It's the size of the viewport minus the scrollbars.
     */
    public width: number;
    /**
     * The height of the editor in pixels. It's the size of the viewport minus the scrollbars.
     */
    public height: number;

    /**
     * The width of the content of the viewport in pixels. This size is computed with the current ration of pixels by
     * milliseconds.
     */
    public worldWidth: number;
    /**
     * The height of the content of the viewport in pixels. This size is computed with the number of tracks multiplied
     * by the number of the tracks.
     */
    public worldHeight: number;

    /**
     * The viewport of the editor, that handle the canvas to be drawn at the correct given position.
     */
    public viewport: Viewport;
    /**
     * Array of PIXI Containers that contains the waveforms of each tracks.
     */
    public waveforms: WaveformView[];
    /**
     * The PIXI Container that handle the playhead behavior.
     */
    public playhead: PlayheadView;
    /**
     * The PIXI Container that handle the loop behavior.
     */
    public loop: LoopView;
    /**
     * The PIXI Container that handle the grid of bars.
     */
    public grid: GridView;
    /* follow grid cells "magnetically" when moving a region */
    public snapping: boolean = true;
    public snapResolution: number = 4;
    public snapTriplet: boolean = false;

    public selectionBox: Graphics;
    public rangeSelectionGraphics: Graphics;
    public timelineRangeGraphics: Graphics;
    public separatorsGraphics: Graphics;

    public static readonly PLAYHEAD_HEIGHT = 17;
    public static readonly PLAYHEAD_WIDTH = 10;
    public static readonly LOOP_HEIGHT = 7;


    /**
     * The center of the viewport. Used to store where the center of the current viewport size is.
     * @private
     */
    private _originalCenter: { x: number, y: number };

    public onResize: (() => void)[] = [];

    /**
     * The main application.
     */
    private _app: App;

    public get app() { return this._app; }

    constructor(app: App) {
        super({
            width: 0,
            height: 0,
        });
        this._app = app;
        this.canvasContainer.appendChild(this.view as HTMLCanvasElement);

        this.width = this.canvasContainer.clientWidth;
        this.height = this.canvasContainer.clientHeight;

        this.renderer.resize(this.width, this.height);

        this.worldWidth = this.width;
        this.worldHeight = this.height;

        this._originalCenter = { x: this.width / 2, y: this.height / 2 };

        this.viewport = new Viewport({
            screenWidth: this.width,
            screenHeight: this.height,
            worldWidth: this.worldWidth,
            worldHeight: this.worldHeight,
            events: this.renderer.events
        });

        this.horizontalScrollbar.resize(this.width, this.worldWidth);
        this.verticalScrollbar.resize(this.height, this.worldHeight);

        this.waveforms = [];
        this.playhead = new PlayheadView(this);
        this.loop = new LoopView(this);
        this.grid = new GridView(this);
        this.grid.eventMode = "dynamic";

        this.rangeSelectionGraphics = new Graphics();
        this.rangeSelectionGraphics.zIndex = 90;
        this.rangeSelectionGraphics.eventMode = 'none';
        this.viewport.addChild(this.rangeSelectionGraphics);

        this.timelineRangeGraphics = new Graphics();
        this.timelineRangeGraphics.zIndex = 101;
        this.timelineRangeGraphics.eventMode = 'none'; // So events pass through to track/grid
        this.viewport.addChild(this.timelineRangeGraphics);

        this.selectionBox = new Graphics();
        this.selectionBox.zIndex = 100; // Above regions
        this.viewport.addChild(this.selectionBox);

        this.separatorsGraphics = new Graphics();
        this.separatorsGraphics.zIndex = -20; // Below waveforms
        this.viewport.addChild(this.separatorsGraphics);


        this.viewport.sortableChildren = true;
        this.stage.sortableChildren = true;

        this.stage.addChild(this.viewport);

        // Resize Canvas initially
        this.resizeCanvas();

        // Use ResizeObserver to detect any layout changes (window resize, plugin rack resize, etc.)
        // Initialized AT THE END to ensure all properties are ready
        const observer = new ResizeObserver(() => {
            this.resizeCanvas();
        });
        observer.observe(this.editorDiv);
        observer.observe(this.canvasContainer);
    }

    public drawTimelineSelection(x: number, width: number) {
        this.timelineRangeGraphics.clear();
        this.timelineRangeGraphics.beginFill(0xFFFFFF, 0.8);
        this.timelineRangeGraphics.drawRect(x, EditorView.LOOP_HEIGHT, width, EditorView.PLAYHEAD_HEIGHT);
        this.timelineRangeGraphics.endFill();
    }

    public clearTimelineSelection() {
        this.timelineRangeGraphics.clear();
    }

    public drawRangeSelection(x: number, width: number) {
        this.rangeSelectionGraphics.clear();
        this.rangeSelectionGraphics.beginFill(0xFFFFFF, 0.3);
        this.rangeSelectionGraphics.drawRect(x, 0, width, this.worldHeight);
        this.rangeSelectionGraphics.endFill();

        // Also draw timeline part
        this.drawTimelineSelection(x, width);
    }

    public clearRangeSelection() {
        this.rangeSelectionGraphics.clear();
        this.clearTimelineSelection();
    }

    public drawSelectionBox(x: number, y: number, w: number, h: number) {
        this.selectionBox.clear();
        this.selectionBox.beginFill(0xFFFFFF, 0.3);
        this.selectionBox.lineStyle(1, 0xFFFFFF, 0.8);
        this.selectionBox.drawRect(x, y, w, h);
        this.selectionBox.endFill();
    }

    public clearSelectionBox() {
        this.selectionBox.clear();
    }

    get cellSize() {
        const beatDuration = 60000 / TEMPO;
        let snapDuration = (4 / this.snapResolution) * beatDuration;
        if (this.snapTriplet) {
            snapDuration = snapDuration * 2 / 3;
        }
        return snapDuration / RATIO_MILLS_BY_PX;
    }
    /**
     * Handler for the wheel event on the editor. It will scroll vertically or horizontally depending on the
     * shiftKey.
     *
     * @param e Event that contains information of the wheel event.
     */
    public handleWheel(e: WheelEvent): void {
        console.log("handleWheel");
        let target = e.target as HTMLElement;
        if (target !== this.view as HTMLCanvasElement && target !== this.canvasContainer && target !== this.editorDiv && target !== this.horizontalScrollbar && target !== this.verticalScrollbar) return;
        if (e.shiftKey) {
            this.horizontalScrollbar.customScrollTo(e.deltaX * 2);
        }
        else {
            this.verticalScrollbar.customScrollTo(e.deltaY);
        }
    }

    /**
     * Handler for the horizontal scroll. It will scroll the automations
     * the editor and the playhead to the left or right.
     *
     * @param e Event that contains the value of the change of the scrollbar.
     */
    public handleHorizontalScroll(e: ScrollEvent): void {
        if (!e.detail) throw new Error("The event on the scrollbar is not properly set. Missing the detail property.");
        this.playhead.viewportLeft = e.detail.value
    }

    /**
     * Handler for the vertical scroll. It will scroll the automations
     * the editor and the playhead to the top or bottom.
     *
     * @param e Event that contains the value of the change of the scrollbar.
     */
    public handleVerticalScroll(e: ScrollEvent): void {
        if (!e.detail) throw new Error("The event on the scrollbar is not properly set. Missing the detail property.");
        let scrollValue = e.detail.value
        if (isNaN(scrollValue)) return;

        if (e.detail.type !== "propagate off") {
            this.trackContainer.scrollTop = scrollValue;
        }

        if (scrollValue === 0) {
            this.viewport.position.set(this.viewport.position.x, 0);
            this.playhead.position.y = 0;
            this.playhead.track.position.y = 0;
            this.loop.position.y = 0;
            this.loop.track.position.y = 0;
            this.grid.position.y = 0;
        }
        else {
            this.viewport.y = -scrollValue;

            this.playhead.position.y = -this.viewport.y;
            this.playhead.track.position.y = -this.viewport.y;
            this.loop.position.y = -this.viewport.y;
            this.loop.track.position.y = -this.viewport.y;

            this.grid.position.y = -this.viewport.y;
        }
    }

    /**
     * Add a waveform into the canvas fot the given track and update the position of the other waveforms.
     * @param track - The track where the new waveform will be created.
     */
    public createWaveformView(track: Track): WaveformView {
        let wave = new WaveformView(this, track);
        this.waveforms.push(wave);
        this.resizeCanvas();
        this.grid.resize();

        return wave;
    }

    public addWaveformView(waveformView: WaveformView) {
        if (waveformView.trackId === -1) {
            this.waveforms.unshift(waveformView);
        } else {
            this.waveforms.push(waveformView);
        }
        this.resizeCanvas();
        this.grid.resize();
    }

    /**
     * Remove the waveform from the canvas for the given track and update the position of the other waveforms.
     * @param track - The track that contain the waveform to delete.
     */
    public removeWaveForm(track: Track): void {
        let wave = this.waveforms.find(wave => wave.trackId === track.id);
        let index = this.waveforms.indexOf(wave!);

        wave!.destroy();
        this.waveforms.splice(index, 1);
        this.resizeCanvas();
    }


    public getWaveformAtPos(y: number): WaveformView | undefined {
        let globalY = this.viewport.top + y;
        return this.waveforms.find(w => globalY >= w.position.y && globalY <= w.position.y + HEIGHT_TRACK)
    }

    public getWaveformById(trackId: number): WaveformView | undefined {
        return this.waveforms.find(w => w.trackId === trackId);
    }

    /**
     * Resize the canvas when the window is resized. It will resize the playhead, the viewport, the PIXI.Renderer,
     * the canvas and the automation div.
     */
    public resizeCanvas(): Promise<void> {
        return new Promise(resolve => {
            requestAnimationFrame(() => {
                this.stage.scale.x = 1
                let scrollbarThickness = this.horizontalScrollbar.SCROLL_THICKNESS
                this.width += (this.editorDiv.clientWidth - this.width) - scrollbarThickness
                this.height += (this.editorDiv.clientHeight - this.height) - scrollbarThickness

                let tracksHeight = this.waveforms.reduce((acc, wave) => {
                    let h = (wave.track && wave.trackId !== -1) ? HEIGHT_TRACK : 0; // Global BPM waveform has 0 base height
                    if (wave.track && wave.track.isAutomationOpened) {
                        const laneCount = Math.max(1, wave.track.automationRegions.length);
                        h += HEIGHT_AUTOMATION * laneCount;
                    } else if (wave.trackId === -1 && this._app.host.bpmAutomationOpened) {
                        // Global BPM Automation Special case
                        h += HEIGHT_AUTOMATION;
                    }
                    return acc + h;
                }, 0) + HEIGHT_NEW_TRACK + 4 + EditorView.LOOP_HEIGHT + EditorView.PLAYHEAD_HEIGHT
                this.worldHeight = Math.max(tracksHeight, this.height)

                // Update waveforms positions
                this.separatorsGraphics.clear();
                this.separatorsGraphics.lineStyle(2, 0x7b7b7b, 1);

                let currentY = EditorView.LOOP_HEIGHT + EditorView.PLAYHEAD_HEIGHT;
                for (let wave of this.waveforms) {
                    wave.position.y = currentY;
                    
                    if (wave.track && wave.trackId !== -1) {
                        wave.drawGhostAutomations();
                        currentY += HEIGHT_TRACK;
                        
                        // Draw separator below track
                        this.separatorsGraphics.moveTo(0, currentY);
                        this.separatorsGraphics.lineTo(this.worldWidth, currentY);
                    }

                    // Handle automation lanes (for both tracks and global BPM)
                    if (wave.track && wave.track.isAutomationOpened) {
                        wave.updateAutomationPositions();
                        const laneCount = Math.max(1, wave.track.automationRegions.length);
                        for (let i = 0; i < laneCount; i++) {
                            currentY += HEIGHT_AUTOMATION;
                            // Draw separator below each automation lane
                            this.separatorsGraphics.moveTo(0, currentY);
                            this.separatorsGraphics.lineTo(this.worldWidth, currentY);
                        }
                    } else if (wave.trackId === -1 && this._app.host.bpmAutomationOpened) {
                        // Global BPM automation special case
                        // Positioning of points is handled inside wave (WaveformView)
                        wave.updateAutomationPositions();
                        currentY += HEIGHT_AUTOMATION;
                        
                        // Draw separator below global BPM automation
                        this.separatorsGraphics.moveTo(0, currentY);
                        this.separatorsGraphics.lineTo(this.worldWidth, currentY);
                    }
                }
                this.worldWidth = Math.max(this._app.msToX(MAX_DURATION_SEC * 1000), this.width)

                this._originalCenter = { x: this.width / 2, y: this.height / 2 }

                this.viewport.resize(this.width, this.height, this.worldWidth, this.worldHeight)
                this.renderer.resize(this.width, this.height)
                this.horizontalScrollbar.resize(this.width, this.worldWidth)
                this.verticalScrollbar.resize(this.height, this.worldHeight)

                this.canvasContainer.style.width = `${this.width}px`
                this.canvasContainer.style.height = `${this.height}px`

                this.playhead.resize()
                this.loop.resize()
                this.grid.resize()
                this.grid.resize()

                this.onResize.forEach(cb => cb());
                resolve()
            })
        })
    }

    /**
     * Change the color of the waveform for the given track.
     * @param track - The track where the Waveform must be redrawn.
     */
    public changeWaveFormColor(track: Track): void {
        let waveFormView = this.waveforms.find(wave => wave.trackId === track.id);
        if (waveFormView !== undefined) {
            waveFormView.color = track.color;
            waveFormView.regionViews.forEach(regionView => {
                let region = track.getRegionById(regionView.id);
                if (region !== undefined) {
                    regionView.redraw(track.color, region);
                }
            });
        }
    }

    /**
     * Draw the waveform of all the regions of a track. Mind that this method has a high impact on performances.
     *
     * @param track - The track that contains the regions.
     */
    public drawRegions(track: Track): void {
        requestAnimationFrame(() => {
            let waveFormView = this.waveforms.find(wave => wave.trackId === track.id);
            if (!waveFormView) return
            for (let regionView of waveFormView.regionViews) {
                let region = track.getRegionById(regionView.id);
                if (region) {
                    regionView.initializeRegionView(track.color, region);
                }
            }
        });
    }

    /**
     * Take the waveform of the given track, and stretch the waveform to the current Ratio of pixels by 
     * milliseconds.
     * @param track - The track that contains the regions.
     */
    public stretchRegions(track: Track): Promise<void> {
        return new Promise(resolve => {
            requestAnimationFrame(() => {
                let waveFormView = this.waveforms.find(wave => wave.trackId === track.id);
                if (!waveFormView) return
                for (let regionView of waveFormView.regionViews) {
                    // MB : prevented first click on ZoomIn to do something
                    //if (!track.audioBuffer) return;
                    let region = track.getRegionById(regionView.id);
                    if (region) {
                        regionView.stretch(region.duration / 1000, region.start, region.start);
                    }
                    regionView.redrawSoon(track.color, region);
                }
                resolve()
            });
        })
    }

    /**
     * Get the waveform by the given track ID.
     * @param trackId - The track ID of the waveform.
     */
    public getWaveFormViewById(trackId: number): WaveformView | undefined {
        return this.waveforms.find(wave => wave.trackId === trackId);
    }

    public createBarGrid() {
        let grid = new GridView(this);
    }

    public setLoading(isLoading: boolean): void {
        let loadingIcon = document.querySelector('#loading-icon') as HTMLElement;
        if (isLoading) {
            if (!loadingIcon) {
                loadingIcon = document.createElement('div') as HTMLElement;
                loadingIcon.id = 'loading-icon';
                loadingIcon.style.position = 'fixed';
                loadingIcon.style.top = '0';
                loadingIcon.style.left = '0';
                loadingIcon.style.width = '100vw';
                loadingIcon.style.height = '100vh';
                loadingIcon.style.display = 'flex';
                loadingIcon.style.alignItems = 'center';
                loadingIcon.style.justifyContent = 'center';
                loadingIcon.style.zIndex = '9999';
                loadingIcon.style.backgroundColor = 'rgba(0, 0, 0, 0.5)';
                loadingIcon.innerHTML = `
                    <div class="spinner-border text-primary" role="status">
                        <span class="sr-only"></span>
                    </div>
                `;
                document.body.appendChild(loadingIcon);
            }
        } else {
            if (loadingIcon) loadingIcon.remove();
        }
    }
}