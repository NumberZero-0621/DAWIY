import { FederatedPointerEvent, Point, Graphics } from "pixi.js";
import App, { crashOnDebug } from "../../../App";
import { MIDI } from "../../../Audio/MIDI/MIDI";
import { HEIGHT_AUTOMATION, RATIO_MILLS_BY_PX, TEMPO } from "../../../Env";
import AutomationRegion from "../../../Models/Region/AutomationRegion";
import MIDIRegion from "../../../Models/Region/MIDIRegion";
import Region, { RegionOf, RegionType } from "../../../Models/Region/Region";
import SampleRegion from "../../../Models/Region/SampleRegion";
import Track from "../../../Models/Track/Track";
import { isKeyPressed, registerOnKeyDown, registerOnKeyUp } from "../../../Utils/keys";
import EditorView from "../../../Views/Editor/EditorView";
import AutomationRegionView from "../../../Views/Editor/Region/AutomationRegionView";
import MIDIRegionView from "../../../Views/Editor/Region/MIDIRegionView";
import RegionView from "../../../Views/Editor/Region/RegionView";
import SampleRegionView from "../../../Views/Editor/Region/SampleRegionView";
import WaveformView from "../../../Views/Editor/WaveformView.js";
import { SelectionManager } from "../Track/SelectionManager";
import { audioCtx } from "../../../index";
import { lightenColor } from "../../../Utils/Color";

/**
 * Class that control the regions of the editor.
 */
export default class RegionController {

    private static regionViewFactories: { [key: RegionType<any>]: ((editor: EditorView, from: RegionOf<any>) => RegionView<any>) } = {
        [MIDIRegion.TYPE]: (editor, region) => new MIDIRegionView(editor, region as MIDIRegion),
        [SampleRegion.TYPE]: (editor, region) => new SampleRegionView(editor, region as SampleRegion),
        [AutomationRegion.TYPE]: (editor, region) => new AutomationRegionView(editor, region as AutomationRegion)
    }

    public regionIdCounter: number;
    protected _app: App;
    protected _editorView: EditorView;
    protected _offsetX: number;
    protected snappingDisabled: boolean = false;
    protected previousMouseXPos: number = 0;
    private _dragGhosts: Graphics[] = [];
    private lastGlobalPos: Point = new Point();
    private _lastClickedRegion: { region: RegionOf<any>, trackId: number } | null = null;

    private _arrowMoveState: {
        regions: { region: RegionOf<any>, view: RegionView<any>, initialPos: number }[],
        totalDirection: number
    } | null = null;
    private _arrowKeyTimer: any = null;
    private _arrowKeyInterval: any = null;

    protected draggedRegionState: {
        anchorRegion: RegionOf<any>,
        initialAnchorPos: number,
        initialGlobalX: number,
        initialViewportLeft: number,
        hasMoved: boolean,
        regionToDeselect: RegionOf<any> | null,
        draggingRegions: {
            region: RegionOf<any>,
            initialPos: number,
            initialTrackId: number,
            offsetMs: number
        }[]
    } | undefined = undefined

    protected oldTrackWhenMoving!: Track;
    protected newTrackWhenMoving!: Track;
    private regionClipboard: { region: RegionOf<any>, track: Track }
    scrollingRight: boolean = false;
    scrollingLeft: boolean = false;
    incrementScrollSpeed: number = 0;
    viewportAnimationLoopId: number = 0;
    selectedRegionEndOutsideViewport: boolean = false;
    selectedRegionStartOutsideViewport: boolean = false;

    // Mode States
    private _isSelecting: boolean = false;
    private _selectionStart: Point = new Point();
    private _initialSelection: Set<RegionOf<any>> = new Set();
    private _isCreating: boolean = false;
    private _creationStart: number = 0;
    private _newRegion: MIDIRegion | null = null;
    private _targetTrack: Track | null = null;

    private _lastMoveEvent: FederatedPointerEvent | null = null;

    // Resize State
    private _isResizing: boolean = false;
    private _resizeState: {
        mode: 'LEFT' | 'RIGHT';
        initialX: number;
        region: RegionOf<any>;
        initialStart: number;
        initialDuration: number;
    } | null = null;
    private readonly RESIZE_ZONE = 5;

    // Automation Drag State
    private draggedAutomationPoint: {
        region: AutomationRegion,
        pointIndex: number,
        originalPoints: { time: number, value: number, curve: number }[]
    } | null = null;

    doIt

    constructor(app: App) {
        this._app = app
        this._editorView = app.editorView
        this.regionIdCounter = 0
        this.doIt = app.doIt.bind(app)
        this.bindEvents()
        this.initSelection()
    }

    public getView<T extends RegionOf<T>>(region: T, callback?: (view: RegionView<T>) => void): RegionView<T>
    public getView<T extends RegionOf<T>>(region: T | undefined | null, callback?: (view: RegionView<T>) => void): RegionView<T> | undefined
    public getView<T extends RegionOf<T>>(region: T | undefined | null, callback?: (view: RegionView<T>) => void): RegionView<T> | undefined {
        if (!region) return undefined
        const waveform = this._editorView.getWaveFormViewById(region.trackId)
        const view = waveform?.getRegionViewById(region.id)
        if (view && callback) callback(view)
        return view
    }

    readonly selection = new SelectionManager<RegionOf<any>>()

    private initSelection() {
        this.selection.onPrimaryChange.add((previous, selected) => {
            this.getView(previous, it => it.isSelected = false)
            this.getView(selected, it => it.isSelected = true)
        })
        this.selection.onSecondaryAdd.add(region => {
            this.getView(region, it => it.isSubSelected = true)
        })
        this.selection.onSecondaryRemove.add(region => {
            this.getView(region, it => it.isSubSelected = false)
        })
    }

    get tracks() { return this._app.tracksController.tracks }

    public addRegion<T extends RegionOf<T>>(track: Track, region: RegionOf<T>, waveform?: WaveformView): RegionView<T> {
        if (track.regions.indexOf(region) >= 0) crashOnDebug("Try to add a region already in the track")
        if (region.id === -1) region.id = this.getNewId()
        const factory = RegionController.regionViewFactories[region.regionType]!
        if (!factory) { crashOnDebug("No factory for region type " + region.regionType) }
        track.addRegion(region)
        track.modified = true
        let regionView = factory(this._editorView, region)
        this.bindRegionEvents(region, regionView)
        regionView.initializeRegionView(track.color, region)
        waveform ??= this._editorView.getWaveFormViewById(track.id)!
        waveform.addChild(regionView)
        waveform.regionViews.push(regionView)
        return regionView
    }

    public mergeRegionWith<T extends RegionOf<T>>(region: T, extension: T) {
        region.mergeWith(extension)
        const view = this.getView(region)
        const waveform = this._editorView.getWaveFormViewById(region.trackId)!
        const track = this._app.tracksController.getTrackById(region.trackId)!
        if (!view) { crashOnDebug("Try to merge into a region without view"); return; }
        track.modified = true
        if (extension.start < region.start) { view.redraw(waveform.color, region); }
        else {
            const redrawStart = extension.start - region.start
            const redrawEnd = extension.end - region.start
            view.draw(waveform.color, region, redrawStart, redrawEnd)
        }
    }

    public moveRegion(region: RegionOf<any>, newTrack: Track, newX?: number) {
        if (newX !== undefined) {
            region.start = newX * RATIO_MILLS_BY_PX
            const view = this._editorView.getWaveFormViewById(newTrack.id)!.getRegionViewById(region.id)
            if (view) view.position.x = newX;
            if (region.trackId === newTrack.id) { newTrack.modified = true }
        }
        if (region.trackId !== newTrack.id) {
            const selected = this.selection.isSelected(region)
            this.removeRegion(region);
            const newview = this.addRegion(newTrack, region)
            if (selected) this.selection.add(region)
        }
    }

    public getMaxDurationRegions(): number {
        let maxTime = 0;
        for (let track of this.tracks) {
            for (let region of track.regions) {
                let end = region.start / 1000 + region.duration / 1000;
                if (end > maxTime) { maxTime = end; }
            }
        }
        return maxTime;
    }

    private lastClickTime: number = 0;

    public hasSelection(): boolean { return !!this.selection.primary; }
    public hasClipboard(): boolean { return !!this.regionClipboard; }

    private handleRegionArrowPress(direction: number) {
        if (this._arrowMoveState) return;

        const regionsToMove: { region: RegionOf<any>, view: RegionView<any>, initialPos: number }[] = [];
        for (const region of this.selection.selecteds) {
            const view = this.getView(region);
            if (view) {
                regionsToMove.push({ region, view, initialPos: region.pos });
            }
        }
        if (regionsToMove.length === 0) return;

        this._arrowMoveState = { regions: regionsToMove, totalDirection: 0 };

        const stepMove = () => {
            if (!this._arrowMoveState) return;
            this._arrowMoveState.totalDirection += direction;
            const beatDurationMs = (60 / TEMPO) * 1000;
            const distancePx = (this._arrowMoveState.totalDirection * beatDurationMs) / RATIO_MILLS_BY_PX;

            for (const item of this._arrowMoveState.regions) {
                item.view.position.x = item.initialPos + distancePx;
            }
        };

        stepMove();

        this._arrowKeyTimer = setTimeout(() => {
            this._arrowKeyInterval = setInterval(stepMove, 50);
        }, 500);
    }

    private stopRegionArrowRepeat() {
        if (this._arrowKeyTimer) clearTimeout(this._arrowKeyTimer);
        if (this._arrowKeyInterval) clearInterval(this._arrowKeyInterval);
        this._arrowKeyTimer = null;
        this._arrowKeyInterval = null;

        if (!this._arrowMoveState) return;

        if (this._arrowMoveState.totalDirection !== 0) {
            const beatDurationMs = (60 / TEMPO) * 1000;
            const distanceMs = this._arrowMoveState.totalDirection * beatDurationMs;

            const moves: { region: RegionOf<any>, oldTrack: Track, oldX: number, newTrack: Track, newX: number }[] = [];
            for (const item of this._arrowMoveState.regions) {
                const oldTrack = this._app.tracksController.getTrackById(item.region.trackId)!;
                const oldX = item.initialPos;
                const newStartMs = Math.max(0, item.region.start + distanceMs);
                const newX = newStartMs / RATIO_MILLS_BY_PX;
                moves.push({ region: item.region, oldTrack, oldX, newTrack: oldTrack, newX });
            }

            if (moves.length > 0) {
                this.doIt(true,
                    () => moves.forEach(m => this.moveRegion(m.region, m.newTrack, m.newX)),
                    () => {
                        moves.slice().reverse().forEach(m => this.moveRegion(m.region, m.oldTrack, m.oldX));
                    }
                );
            }
        }

        this._arrowMoveState = null;
    }

    bindRegionEvents(region: Region, regionView: RegionView<any>): void {
        regionView.on("pointermove", (e: FederatedPointerEvent) => {
            if (!this._isResizing && !this.draggedRegionState) {
                const localPos = regionView.toLocal(e.global);
                if (localPos.x < this.RESIZE_ZONE) {
                    regionView.cursor = "w-resize";
                } else if (localPos.x > regionView.width - this.RESIZE_ZONE) {
                    regionView.cursor = "e-resize";
                } else {
                    regionView.cursor = "default";
                }
            }
        });

        regionView.on("pointerdown", (_e) => {
            this._app.contextMenuController.hide();
            if (_e.button !== 0 && _e.button !== 2) return;

            const localPos = regionView.toLocal(_e.global);
            let resizeMode: 'LEFT' | 'RIGHT' | null = null;

            if (_e.button === 0) {
                if (localPos.x < this.RESIZE_ZONE) resizeMode = 'LEFT';
                else if (localPos.x > regionView.width - this.RESIZE_ZONE) resizeMode = 'RIGHT';

                if (resizeMode) {
                    this._isResizing = true;
                    this._resizeState = {
                        mode: resizeMode,
                        initialX: _e.global.x,
                        region: region as RegionOf<any>,
                        initialStart: region.start,
                        initialDuration: region.duration / 1000
                    };
                    this._resizeState.initialDuration = region.duration;
                    _e.stopPropagation();
                    return;
                }
            }

            const now = Date.now();
            const isDoubleClick = (now - this.lastClickTime) < 300;
            this.lastClickTime = now;
            this.handlePointerDown(_e, regionView);
            if (_e.button === 0) {
                this._offsetX = _e.data.global.x - regionView.position.x;
            }

            let track = this._app.tracksController.getTrackById(region.trackId);
            if (track) this._app.tracksController.select(track);
            if (isDoubleClick && region instanceof MIDIRegion && _e.button === 0) {
                this.selection.set(null);
                this._app.pianoRollController.open(region);
            }
            _e.stopPropagation();
        });
        regionView.on("pointerup", () => this.handlePointerUp());
        regionView.on("pointerupoutside", () => this.handlePointerUp());
    }

    public updateRegionView(region: RegionOf<any>) {
        const view = this.getView(region);
        const waveform = this._editorView.getWaveFormViewById(region.trackId);
        if (view && waveform) { view.redraw(waveform.color, region); }
    }

    private bindEvents(): void {
        registerOnKeyUp(key => {
            if (key == "Shift") this.snappingDisabled = false
            if (key === "ArrowLeft" || key === "ArrowRight") this.stopRegionArrowRepeat();
        });
        registerOnKeyDown((key, e) => {
            if (this._app.pianoRollController.isVisible) return;
            const meta = isKeyPressed("Control", "Meta")
            switch (key) {
                case "Shift":
                    this.snappingDisabled = true;
                    break;
            }

            // ShortcutController checks
            if (this._app.shortcutController.isTriggered("editor.deselect", e)) {
                this._app.contextMenuController.hide();
                this.selection.set(null);
            }
            if (this._app.shortcutController.isTriggered("editor.delete", e)) {
                this._app.contextMenuController.hide();
                this.deleteSelectedRegion(true);
            }
            if (this._app.shortcutController.isTriggered("editor.split", e)) {
                this._app.contextMenuController.hide();
                this.splitSelectedRegion();
            }
            if (this._app.shortcutController.isTriggered("editor.merge", e)) {
                this._app.contextMenuController.hide();
                this.mergeSelectedRegion();
            }
            if (this._app.shortcutController.isTriggered("edit.cut", e)) {
                this._app.contextMenuController.hide();
                this.cutSelectedRegion();
            }
            if (this._app.shortcutController.isTriggered("edit.copy", e)) {
                this._app.contextMenuController.hide();
                this.copySelectedRegion();
            }
            if (this._app.shortcutController.isTriggered("edit.paste", e)) {
                this._app.contextMenuController.hide();
                this.pasteRegion(true);
            }
            if (this._app.shortcutController.isTriggered("edit.selectAll", e)) {
                this._app.contextMenuController.hide();
                this.selectAllRegions();
                e.preventDefault();
            }
            if (this.hasSelection() && (key === "ArrowLeft" || key === "ArrowRight") && !meta) {
                const direction = (key === "ArrowRight") ? 1 : -1;
                this.handleRegionArrowPress(direction);
            }
        });

        this._editorView.viewport.on("pointerdown", (e) => {
            this._app.contextMenuController.hide();
            this._app.playheadController.clearRange();
            const originalEvent = e.originalEvent as unknown as MouseEvent;
            if (e.data.global.y < EditorView.PLAYHEAD_HEIGHT + 20) return;

            this.lastGlobalPos.copyFrom(e.data.global);

            // Right-click drag selection
            if (e.button === 2) {
                this._isSelecting = true;
                this._initialSelection = new Set(this.selection.selecteds);
                this._selectionStart = this._editorView.viewport.toLocal(e.data.global);
                this.viewportAnimationLoopId = requestAnimationFrame(this.viewportAnimationLoop.bind(this));
                return;
            }

            this.viewportAnimationLoopId = requestAnimationFrame(this.viewportAnimationLoop.bind(this));

            if (App.TOOL_MODE === "SELECT") {
                this._isSelecting = true;
                this._selectionStart = this._editorView.viewport.toLocal(e.data.global);

                // Deselect all only on left-click without modifiers
                if (e.button === 0 && !originalEvent.ctrlKey && !originalEvent.shiftKey) {
                    this.selection.set(null);
                }
                this._initialSelection = new Set(this.selection.selecteds);
            } else if (App.TOOL_MODE === "PEN") {
                const globalY = e.data.global.y;
                const waveform = this._editorView.getWaveformAtPos(globalY);
                if (waveform) {
                    this._targetTrack = this._app.tracksController.getTrackById(waveform.trackId)!;
                    if (this._targetTrack) {
                        this._isCreating = true;
                        let globalX = e.data.global.x + this._editorView.viewport.left;
                        if (this._editorView.snapping && !this.snappingDisabled) {
                            const cellSize = this._editorView.cellSize;
                            globalX = Math.round(globalX / cellSize) * cellSize;
                        }
                        this._creationStart = Math.max(0, globalX * RATIO_MILLS_BY_PX);
                        const midi = MIDI.empty(500, 0);
                        this._newRegion = new MIDIRegion(midi, this._creationStart);
                        this.addRegion(this._targetTrack, this._newRegion);
                    }
                }
            }
        });

        this._editorView.viewport.on("pointermove", (e) => {
            if (this.draggedAutomationPoint) {
                this.handleAutomationPointDrag(e);
                return;
            }
            this.lastGlobalPos.copyFrom(e.data.global);
            this.checkIfScrollingNeeded(e.data.global.x);

            if (this._isResizing && this._resizeState) {
                const dx = e.data.global.x - this._resizeState.initialX;
                const rawDt = dx * RATIO_MILLS_BY_PX;
                const view = this.getView(this._resizeState.region);

                if (this._resizeState.mode === 'RIGHT') {
                    let newRawEnd = this._resizeState.initialStart + this._resizeState.initialDuration + rawDt;
                    let newSnappedEndX = newRawEnd / RATIO_MILLS_BY_PX;

                    if (this._editorView.snapping && !this.snappingDisabled) {
                        const cellSize = this._editorView.cellSize;
                        newSnappedEndX = Math.round(newSnappedEndX / cellSize) * cellSize;
                    }
                    const newSnappedEnd = newSnappedEndX * RATIO_MILLS_BY_PX;
                    const newDuration = Math.max(10, newSnappedEnd - this._resizeState.initialStart);

                    if (view) view.stretch(newDuration / 1000, this._resizeState.initialStart, this._resizeState.initialStart);
                } else {
                    let newRawStart = this._resizeState.initialStart + rawDt;
                    let newSnappedStartX = newRawStart / RATIO_MILLS_BY_PX;
                    if (this._editorView.snapping && !this.snappingDisabled) {
                        const cellSize = this._editorView.cellSize;
                        newSnappedStartX = Math.round(newSnappedStartX / cellSize) * cellSize;
                    }
                    let newSnappedStart = Math.max(0, newSnappedStartX * RATIO_MILLS_BY_PX);

                    const originalEnd = this._resizeState.initialStart + this._resizeState.initialDuration;
                    if (newSnappedStart >= originalEnd - 10) newSnappedStart = originalEnd - 10;

                    const newDuration = originalEnd - newSnappedStart;
                    if (view) view.stretch(newDuration / 1000, newSnappedStart, this._resizeState.initialStart);
                }
            }
            else if (this.draggedRegionState) { this.handlePointerMove(e) }
            else if (this._isSelecting) {
                const currentPos = e.data.global;
                const localStart = this._selectionStart; // Already in Local/World
                const localCurrent = this._editorView.viewport.toLocal(currentPos);
                const x = Math.min(localStart.x, localCurrent.x);
                const y = Math.min(localStart.y, localCurrent.y);
                const w = Math.max(1, Math.abs(localStart.x - localCurrent.x));
                const h = Math.max(1, Math.abs(localStart.y - localCurrent.y));
                this._editorView.drawSelectionBox(x, y, w, h);
                this.updateSelectionFromBox(x, y, w, h);
            } else if (this._isCreating && this._newRegion && this._targetTrack) {
                let globalX = e.data.global.x + this._editorView.viewport.left;
                if (this._editorView.snapping && !this.snappingDisabled) {
                    const cellSize = this._editorView.cellSize;
                    globalX = Math.round(globalX / cellSize) * cellSize;
                }
                const currentPosMs = globalX * RATIO_MILLS_BY_PX;
                let startMs = this._creationStart;
                let endMs = currentPosMs;
                if (endMs < startMs) { [startMs, endMs] = [endMs, startMs]; }
                let duration = Math.max(10, endMs - startMs);
                this._newRegion.start = startMs;
                this._newRegion.midi.duration = duration;
                const view = this.getView(this._newRegion);
                if (view) {
                    view.position.x = startMs / RATIO_MILLS_BY_PX;
                    view.redraw(this._targetTrack.color, this._newRegion);
                }
            }
        });

        this._editorView.viewport.on("pointerup", (e) => {
            if (this.draggedAutomationPoint) {
                const { region, originalPoints } = this.draggedAutomationPoint;
                const newPoints = JSON.parse(JSON.stringify(region.points)); // Deep copy current state
                const track = this._app.tracksController.getTrackById(region.trackId);
                const view = this.getView(region);

                // Check if actually changed
                const isDifferent = JSON.stringify(originalPoints) !== JSON.stringify(newPoints);

                if (isDifferent && track && view) {
                    this.doIt(true,
                        () => {
                            region.points = newPoints;
                            // Need to update track.automationData as well if paramId matches??
                            // In toggleAutomationVisibility, we see automationData being updated from points.
                            // However, applyAllAutomations reads from region.points for the current param.
                            // So updating region.points is primary.
                            // But better to keep data consistent if we switch params later.
                            if (region.paramId) {
                                track.automationData.set(region.paramId, newPoints);
                            }
                            view.redraw("", region);
                        },
                        () => {
                            region.points = originalPoints;
                            if (region.paramId) {
                                track.automationData.set(region.paramId, originalPoints);
                            }
                            view.redraw("", region);
                        }
                    );
                }

                this.draggedAutomationPoint = null;
                return;
            }
            this.handlePointerUp();
            this.scrollingLeft = false;
            this.scrollingRight = false;
            if (this._isSelecting) {
                this._isSelecting = false;
                this._editorView.clearSelectionBox();
            }
            if (this._isCreating) {
                this._isCreating = false;
                if (this._newRegion && this._targetTrack) {
                    const region = this._newRegion;
                    const track = this._targetTrack;
                    this._app.addRedoUndo(
                        () => {
                            this.addRegion(track, region);
                            this.selection.set(region);
                        },
                        () => { this.removeRegion(region); }
                    );
                    this.selection.set(this._newRegion);
                    this._targetTrack.update(audioCtx);
                }
                this._newRegion = null;
                this._targetTrack = null;
            }
        });

        this._editorView.viewport.on("pointerupoutside", (e) => {
            this.handlePointerUp();
            this.scrollingLeft = false;
            this.scrollingRight = false;
            this._isSelecting = false;
            this._editorView.clearSelectionBox();
            this._isCreating = false;
            this._newRegion = null;
            this._targetTrack = null;
        });
    }

    private getNewId(): number { return this.regionIdCounter++; }

    private handlePointerDown(e: FederatedPointerEvent, regionView: RegionView<any>): void {
        this.lastGlobalPos.copyFrom(e.global);
        this.viewportAnimationLoopId = requestAnimationFrame(this.viewportAnimationLoop.bind(this));

        const region = this._app.tracksController.getTrackById(regionView.trackId)?.getRegionById(regionView.id) as RegionOf<any>

        // Automation Interaction
        if (region instanceof AutomationRegion) {
            this.handleAutomationPointerDown(e, region, regionView as AutomationRegionView);
            return;
        }

        let regionToDeselect: RegionOf<any> | null = null;

        if (region) {
            if (e.shiftKey && this._lastClickedRegion) {
                const track1 = this._app.tracksController.getTrackById(this._lastClickedRegion.trackId);
                const track2 = this._app.tracksController.getTrackById(region.trackId);

                if (track1 && track2) {
                    const idx1 = this.tracks.indexOf(track1);
                    const idx2 = this.tracks.indexOf(track2);

                    if (idx1 !== -1 && idx2 !== -1) {
                        const minIdx = Math.min(idx1, idx2);
                        const maxIdx = Math.max(idx1, idx2);

                        const start1 = this._lastClickedRegion.region.start;
                        const start2 = region.start;
                        const minStart = Math.min(start1, start2);
                        const maxStart = Math.max(start1, start2);

                        this.selection.set(null);

                        this.tracks.forEach((track, i) => {
                            if (i >= minIdx && i <= maxIdx) {
                                track.regions.forEach(r => {
                                    if (r.start >= minStart - 0.1 && r.start <= maxStart + 0.1) {
                                        this.selection.add(r as RegionOf<any>);
                                    }
                                });
                            }
                        });
                    }
                }
            } else if (isKeyPressed("Control", "Meta")) {
                if (this.selection.isSelected(region)) {
                    regionToDeselect = region;
                } else {
                    this.selection.toggle(region, true);
                }
                this._lastClickedRegion = { region, trackId: region.trackId };
            }
            else {
                if (!this.selection.isSelected(region)) this.selection.set(region);
                else this.selection.add(region);
                this._lastClickedRegion = { region, trackId: region.trackId };
            }
        }

        if (e.button !== 0) return; // Only start drag if Left Click

        const toMove = this.selection.primary
        const view = this.getView(this.selection.primary)
        if (view && toMove) {
            this.selectedRegionEndOutsideViewport = view.position.x + view.width > this._editorView.viewport.right
            this.selectedRegionStartOutsideViewport = view.position.x < this._editorView.viewport.left;

            const draggingRegions = [];
            for (const r of this.selection.selecteds) {
                draggingRegions.push({
                    region: r,
                    initialPos: r.pos,
                    initialTrackId: r.trackId,
                    offsetMs: r.start - toMove.start
                });
            }

            this.draggedRegionState = {
                anchorRegion: toMove,
                initialAnchorPos: toMove.pos,
                initialGlobalX: e.global.x,
                initialViewportLeft: this._editorView.viewport.left,
                hasMoved: false,
                regionToDeselect: regionToDeselect,
                draggingRegions: draggingRegions
            };

            // Create Ghosts
            this._dragGhosts = [];
            for (const item of draggingRegions) {
                const track = this._app.tracksController.getTrackById(item.initialTrackId);
                const waveform = this._editorView.getWaveFormViewById(item.initialTrackId);
                const regionView = this.getView(item.region);

                if (track && waveform && regionView) {
                    const ghost = new Graphics();
                    let color = 0xFF0000;
                    if (track.color) {
                        color = parseInt(track.color.replace("#", ""), 16);
                    }
                    const fillColor = lightenColor(color, 0.5);

                    ghost.beginFill(fillColor, 0.5);
                    ghost.lineStyle(1, 0xFFFFFF);
                    ghost.drawRect(0, 0, regionView.width, regionView.height); // Use view dimensions
                    ghost.endFill();

                    ghost.position.set(item.initialPos, 0); // Local to waveform
                    ghost.visible = false;

                    waveform.addChild(ghost);
                    this._dragGhosts.push(ghost);
                }
            }
        }
    }

    public removeRegion(region: RegionOf<any>, undoable = false) {
        const track = this._app.tracksController.getTrackById(region.trackId)!
        const waveform = this._editorView.getWaveFormViewById(track.id)!
        this.doIt(undoable,
            () => {
                track.removeRegionById(region.id)
                region.trackId = -1
                track.modified = true
                const view = waveform.getRegionViewById(region.id)!
                waveform.removeRegionView(view)
                this.selection.remove(region)
            },
            () => { this.addRegion(track, region) }
        )
    }

    public deleteSelectedRegion(undoable: boolean): void {
        if (this.draggedRegionState) return;
        const toRemove = this.selection.selecteds.map(it => ({ region: it, track: it.trackId }))
        this.doIt(undoable,
            () => { toRemove.forEach(it => this.removeRegion(it.region)) },
            () => { toRemove.forEach(it => this.addRegion(this._app.tracksController.getTrackById(it.track)!, it.region)) }
        )
    }

    public selectAllRegions() {
        this.selection.set(null);
        for (const track of this.tracks) {
            for (const region of track.regions) {
                this.selection.add(region as RegionOf<any>);
            }
        }
    }

    public copyRegion(region: RegionOf<any>, undoable = false) {
        const oldClipboard = this.regionClipboard
        const track = this._app.tracksController.getTrackById(region.trackId)
        if (!track) return;
        this.doIt(undoable,
            () => { this.regionClipboard = { region: region.clone(), track: track! } },
            () => { this.regionClipboard = oldClipboard }
        )
    }

    public cutRegion(region: RegionOf<any>, undoable = false) {
        const oldClipboard = this.regionClipboard
        const track = this._app.tracksController.getTrackById(region.trackId)!
        this.doIt(undoable,
            () => { this.copyRegion(region, false); this.removeRegion(region) },
            () => { this.regionClipboard = oldClipboard; this.addRegion(track, region) }
        )
    }

    public cutSelectedRegion() { if (this.selection.primary) this.cutRegion(this.selection.primary, true); }
    public copySelectedRegion() { if (this.selection.primary) this.copyRegion(this.selection.primary, true); }

    public pasteRegion(undoable: boolean = false) {
        if (!this.regionClipboard) return;
        const { region } = this.regionClipboard
        let track = this._app.tracksController.selectedTrack
        if (!track) track = this.regionClipboard.track
        if (!track) return
        const startinPx = this._app.editorView.playhead.position.x
        const startInMs = this._app.host.playhead;
        if (startinPx + this.regionClipboard.region.width > this._editorView.worldWidth) return
        const newRegion = this.regionClipboard.region.clone() as RegionOf<any>
        newRegion.start = startInMs
        this.doIt(undoable,
            () => { this.addRegion(track!, newRegion); this.selection.set(newRegion); this._app.host.playhead = newRegion.end },
            () => { this.removeRegion(newRegion) }
        )
    }

    public splitSelectedRegion() {
        if (!this.selection.primary) return
        if (!this.isPlayheadOnSelectedRegion()) return
        let originalRegion = this.selection.primary
        const splitPosition = this._app.editorView.playhead.position.x - originalRegion.pos
        const splitTime = splitPosition * RATIO_MILLS_BY_PX;
        let [firstRegion, secondRegion] = originalRegion.split(splitTime);
        let trackId = originalRegion.trackId
        let track = this._app.tracksController.getTrackById(trackId)!
        this.addRegion(track, firstRegion as RegionOf<any>)
        this.addRegion(track, secondRegion as RegionOf<any>)
        this.removeRegion(originalRegion)
        this.selection.set(secondRegion as RegionOf<any>);
        this._app.undoManager.add({
            undo: () => { this.removeRegion(firstRegion as RegionOf<any>); this.removeRegion(secondRegion as RegionOf<any>); this.addRegion(track, originalRegion) },
            redo: () => { this.removeRegion(originalRegion); this.addRegion(track, firstRegion as RegionOf<any>); this.addRegion(track, secondRegion as RegionOf<any>) }
        })
    }

    public mergeSelectedRegion() {
        if (!this.selection.primary || this.selection.secondaryCount <= 0) return;
        let mainRegion = this.selection.primary;
        let otherRegions = [...this.selection.secondaries]
        let track = this._app.tracksController.getTrackById(mainRegion.trackId)!
        const newRegion = mainRegion.clone()
        otherRegions.forEach(it => newRegion.mergeWith(it))
        this.doIt(true,
            () => {
                this.addRegion(track, newRegion)
                if (this.selection.primary === mainRegion) this.selection.set(newRegion)
                this.removeRegion(mainRegion)
                otherRegions.forEach(it => this.removeRegion(it))
            },
            () => {
                const isSelected = this.selection.primary === newRegion
                if (isSelected) this.selection.set(null)
                otherRegions.forEach(it => { this.addRegion(track, it); if (isSelected) this.selection.add(it) })
                this.addRegion(track, mainRegion)
                if (isSelected) this.selection.add(mainRegion)
                this.removeRegion(newRegion)
            }
        )
    }

    isPlayheadOnSelectedRegion() {
        if (!this.selection.primary) return;
        const view = this.getView(this.selection.primary)
        const playHeadPosX = this._app.editorView.playhead.position.x
        const selectedRegionPosX = view.position.x
        const selectedRegionWidth = this.selection.primary.width
        return (playHeadPosX >= selectedRegionPosX && playHeadPosX <= selectedRegionPosX + selectedRegionWidth);
    }

    private updateDragPosition(globalX: number, globalY: number) {
        if (!this.draggedRegionState || !this._offsetX) return;

        const anchor = this.draggedRegionState.anchorRegion;

        // Calculate new X for Anchor
        const scrollDiff = this._editorView.viewport.left - this.draggedRegionState.initialViewportLeft;
        let newX = globalX - this._offsetX + scrollDiff;

        newX = Math.max(0, Math.min(newX, this._editorView.worldWidth));

        // Snapping for Anchor
        if (this._editorView.snapping && !this.snappingDisabled && !this.scrollingLeft && !this.scrollingRight) {
            const cellSize = this._editorView.cellSize;
            newX = Math.round(newX / cellSize) * cellSize;
        }

        // Calculate new Track for Anchor
        const view = this.getView(anchor);
        if (!view) return;
        let parentWaveform = view.parent as WaveformView;
        // Adjust globalY relative to viewport content (scrolling Y might be an issue if implemented, but usually tracks scroll vertically)
        // Here globalY is screen coordinate. Waveform y is relative to container.

        // The original code used globalY + viewport.top to check against waveform Y.
        let y = globalY + this._editorView.viewport.top;

        let parentTop = parentWaveform.y;
        let parentBottom = parentTop + parentWaveform.height;
        let targetTrackId = anchor.trackId;

        if (y > parentBottom && !this._app.waveformController.isLast(parentWaveform)) {
            targetTrackId = this._app.waveformController.getNextWaveform(parentWaveform)?.trackId ?? targetTrackId
        }
        else if (y < parentTop && !this._app.waveformController.isFirst(parentWaveform)) {
            targetTrackId = this._app.waveformController.getPreviousWaveform(parentWaveform)?.trackId ?? targetTrackId
        }

        // Apply changes to ALL regions
        const tracks = this.tracks;
        const anchorInfo = this.draggedRegionState.draggingRegions.find(r => r.region === anchor);
        if (!anchorInfo) return;

        const currentAnchorTrackIndex = tracks.findIndex(t => t.id === anchorInfo.initialTrackId);
        const newAnchorTrackIndex = tracks.findIndex(t => t.id === targetTrackId);
        const trackIndexDelta = newAnchorTrackIndex - currentAnchorTrackIndex;

        // Calculate Anchor Start MS
        const anchorNewStartMs = newX * RATIO_MILLS_BY_PX;

        for (const item of this.draggedRegionState.draggingRegions) {
            // Calculate New Track
            const itemInitialTrackIndex = tracks.findIndex(t => t.id === item.initialTrackId);
            let itemNewTrackIndex = itemInitialTrackIndex + trackIndexDelta;
            itemNewTrackIndex = Math.max(0, Math.min(tracks.length - 1, itemNewTrackIndex));
            const itemNewTrack = tracks.get(itemNewTrackIndex);

            // Calculate New Position
            const itemNewStartMs = Math.max(0, anchorNewStartMs + item.offsetMs);
            const itemNewX = itemNewStartMs / RATIO_MILLS_BY_PX;

            this.moveRegion(item.region, itemNewTrack, itemNewX);
        }
    }

    private handleAutomationPointerDown(e: FederatedPointerEvent, region: AutomationRegion, view: AutomationRegionView) {
        const local = view.toLocal(e.global);
        const height = HEIGHT_AUTOMATION;

        // Find closest point
        let closestIndex = -1;
        let minDist = 10; // Hit radius

        for (let i = 0; i < region.points.length; i++) {
            const p = region.points[i];
            const px = p.time / RATIO_MILLS_BY_PX;
            const py = (1 - p.value) * height;
            const dist = Math.sqrt((local.x - px) ** 2 + (local.y - py) ** 2);
            if (dist < minDist) {
                minDist = dist;
                closestIndex = i;
            }
        }

        const originalPoints = JSON.parse(JSON.stringify(region.points));

        if (closestIndex !== -1) {
            // Drag existing point
            this.draggedAutomationPoint = { region, pointIndex: closestIndex, originalPoints };
        } else {
            // Add new point
            const time = Math.max(0, local.x * RATIO_MILLS_BY_PX);
            const value = Math.max(0, Math.min(1, 1 - (local.y / height)));
            const newPoint = { time, value, curve: 0 };

            region.points.push(newPoint);
            // Sort points
            region.points.sort((a, b) => a.time - b.time);

            closestIndex = region.points.indexOf(newPoint);
            this.draggedAutomationPoint = { region, pointIndex: closestIndex, originalPoints };
        }

        view.redraw("", region);
        e.stopPropagation();
    }

    private handleAutomationPointDrag(e: FederatedPointerEvent) {
        if (!this.draggedAutomationPoint) return;

        const { region, pointIndex } = this.draggedAutomationPoint;
        const view = this.getView(region);
        if (!view) return;

        const local = view.toLocal(e.data.global);
        const height = HEIGHT_AUTOMATION;

        // Calculate new values
        let newTime = Math.max(0, local.x * RATIO_MILLS_BY_PX);
        let newValue = Math.max(0, Math.min(1, 1 - (local.y / height)));

        // Update point
        region.points[pointIndex].time = newTime;
        region.points[pointIndex].value = newValue;

        // Maintain Sort Order
        const pointObj = region.points[pointIndex];
        region.points.sort((a, b) => a.time - b.time);
        this.draggedAutomationPoint.pointIndex = region.points.indexOf(pointObj);

        view.redraw("", region);
    }

    private handlePointerMove(e: FederatedPointerEvent): void {
        if (!this.draggedRegionState || !this._offsetX) return;

        // Check threshold
        if (!this.draggedRegionState.hasMoved) {
            const dist = Math.abs(e.global.x - this.draggedRegionState.initialGlobalX);
            if (dist < 5) return;
            this.draggedRegionState.hasMoved = true;
        }

        // Update Ghosts
        const isCopy = isKeyPressed("Control", "Meta");
        for (const ghost of this._dragGhosts) {
            ghost.visible = isCopy;
        }

        const delta = e.data.global.x - this.previousMouseXPos;
        this.previousMouseXPos = e.data.global.x;
        // Note: We should probably allow updates even if delta is 0 if scroll changed, 
        // but this function is called on pointer move.
        if (delta === 0) return;

        this.updateDragPosition(e.data.global.x, e.data.global.y);
        this.checkIfScrollingNeeded(e.data.global.x);
    }

    checkIfScrollingNeeded(mousePosX: number) {
        if (!this._editorView.viewport) return;
        const screenWidth = this._editorView.screen.width;
        const SCROLL_ZONE = 50;

        this.scrollingRight = mousePosX >= screenWidth - SCROLL_ZONE;
        this.scrollingLeft = mousePosX <= SCROLL_ZONE;

        if (this.scrollingRight) {
            const dist = mousePosX - (screenWidth - SCROLL_ZONE);
            this.incrementScrollSpeed = Math.min(20, Math.max(2, dist / 2));
        } else if (this.scrollingLeft) {
            const dist = SCROLL_ZONE - mousePosX;
            this.incrementScrollSpeed = Math.min(20, Math.max(2, dist / 2));
        }
    }

    map(value: number, istart: number, istop: number, ostart: number, ostop: number) { return ostart + (ostop - ostart) * ((value - istart) / (istop - istart)); }

    viewportAnimationLoop() {
        const isActive = !!this.draggedRegionState || this._isSelecting || this._isCreating;
        if (!isActive) {
            this.scrollingLeft = false;
            this.scrollingRight = false;
            return;
        }

        let viewScrollSpeed = 0;
        if (this.scrollingRight) { viewScrollSpeed = this.incrementScrollSpeed; }
        else if (this.scrollingLeft) { viewScrollSpeed = -this.incrementScrollSpeed; }

        if (viewScrollSpeed !== 0) {
            let viewport = this._editorView.viewport;

            // Update Viewport
            viewport.left += viewScrollSpeed;

            // Clamp
            if (viewport.left < 0) { viewport.left = 0; this.scrollingLeft = false; }
            if (viewport.right > this._editorView.worldWidth) { viewport.right = this._editorView.worldWidth; this.scrollingRight = false; }

            const horizontalScrollbar = this._editorView.horizontalScrollbar;
            horizontalScrollbar.moveTo(viewport.left);
        }

        // 1. Dragging Regions
        if (this.draggedRegionState) {
            this.updateDragPosition(this.lastGlobalPos.x, this.lastGlobalPos.y);
        }

        // 2. Selecting
        if (this._isSelecting) {
            let viewport = this._editorView.viewport;
            // _selectionStart is in Local/World coords (FIXED via pointerdown update)
            // We need current mouse pos in Local/World coords
            const currentLocal = viewport.toLocal(this.lastGlobalPos);

            // Use pre-calculated local start (fixed in world)
            const localStart = this._selectionStart;

            const x = Math.min(localStart.x, currentLocal.x);
            const y = Math.min(localStart.y, currentLocal.y);
            const w = Math.max(1, Math.abs(localStart.x - currentLocal.x));
            const h = Math.max(1, Math.abs(localStart.y - currentLocal.y));

            this._editorView.drawSelectionBox(x, y, w, h);
            this.updateSelectionFromBox(x, y, w, h);
        }

        // 3. Creating
        if (this._isCreating && this._newRegion && this._targetTrack) {
            let viewport = this._editorView.viewport;
            let globalX = this.lastGlobalPos.x + viewport.left;
            if (this._editorView.snapping && !this.snappingDisabled) {
                const cellSize = this._editorView.cellSize;
                globalX = Math.round(globalX / cellSize) * cellSize;
            }

            const currentPosMs = globalX * RATIO_MILLS_BY_PX;
            let startMs = this._creationStart;
            let endMs = currentPosMs;

            if (endMs < startMs) { [startMs, endMs] = [endMs, startMs]; }
            let duration = Math.max(10, endMs - startMs);

            this._newRegion.start = startMs;
            this._newRegion.midi.duration = duration;

            const view = this.getView(this._newRegion);
            if (view) {
                view.position.x = startMs / RATIO_MILLS_BY_PX;
                view.redraw(this._targetTrack.color, this._newRegion);
            }
        }

        requestAnimationFrame(this.viewportAnimationLoop.bind(this));
    }

    private handlePointerUp(): void {
        cancelAnimationFrame(this.viewportAnimationLoopId);

        if (this._isResizing && this._resizeState) {
            // Commit Resize
            const { region: originalRegion, initialStart, initialDuration, mode } = this._resizeState;
            const view = this.getView(originalRegion);

            if (!view) {
                this._isResizing = false;
                this._resizeState = null;
                return;
            }

            const newStartMs = view.position.x * RATIO_MILLS_BY_PX;
            const newDurationMs = view.width * RATIO_MILLS_BY_PX;

            const track = this._app.tracksController.getTrackById(originalRegion.trackId);
            if (!track) {
                this._isResizing = false;
                this._resizeState = null;
                return;
            }

            let regionToAdd: RegionOf<any> | null = null;
            let regionToRemove: RegionOf<any> = originalRegion;

            try {
                if (mode === 'LEFT') {
                    const diff = newStartMs - initialStart;
                    if (diff > 0) { // Shrink from left
                        if (diff < originalRegion.duration) {
                            const [, right] = originalRegion.split(diff);
                            regionToAdd = right as RegionOf<any>;
                        }
                    } else if (diff < 0) { // Extend to left
                        const gapDuration = -diff;
                        const gapRegion = originalRegion.emptyAlike(newStartMs, gapDuration);
                        gapRegion.mergeWith(originalRegion as any);
                        regionToAdd = gapRegion as RegionOf<any>;
                    }
                } else { // RIGHT
                    const diff = newDurationMs - initialDuration;
                    if (diff < 0) { // Shrink from right
                        if (newDurationMs > 0 && newDurationMs < originalRegion.duration) {
                            const [left] = originalRegion.split(newDurationMs);
                            regionToAdd = left as RegionOf<any>;
                        }
                    } else if (diff > 0) { // Extend to right
                        const oldEnd = initialStart + initialDuration;
                        const gapDuration = diff;
                        const gapRegion = originalRegion.emptyAlike(oldEnd, gapDuration);
                        const base = originalRegion.clone();
                        base.mergeWith(gapRegion as any);
                        regionToAdd = base as RegionOf<any>;
                    }
                }
            } catch (e) {
                console.error("Resize operation failed", e);
            }

            if (regionToAdd && regionToAdd !== originalRegion) {
                this.doIt(true,
                    () => {
                        this.removeRegion(regionToRemove);
                        this.addRegion(track, regionToAdd!);
                        this.selection.set(regionToAdd!);
                    },
                    () => {
                        this.removeRegion(regionToAdd!);
                        this.addRegion(track, regionToRemove);
                        this.selection.set(regionToRemove);
                    }
                );
            } else {
                this.updateRegionView(originalRegion);
            }

            this._isResizing = false;
            this._resizeState = null;
            return;
        }

        if (!this.draggedRegionState) return

        if (!this.draggedRegionState.hasMoved) {
            for (const ghost of this._dragGhosts) {
                ghost.destroy();
            }
            this._dragGhosts = [];

            if (this.draggedRegionState.regionToDeselect) {
                this.selection.toggle(this.draggedRegionState.regionToDeselect, true);
            }

            this.draggedRegionState = undefined;
            return;
        }

        this.scrollingLeft = false;
        this.scrollingRight = false;

        // Destroy Ghosts
        for (const ghost of this._dragGhosts) {
            ghost.destroy();
        }
        this._dragGhosts = [];

        const isCopy = isKeyPressed("Control", "Meta");

        if (isCopy) {
            const copies: { region: RegionOf<any>, track: Track }[] = [];
            const originalsToRestore: { region: RegionOf<any>, track: Track, pos: number }[] = [];

            for (const item of this.draggedRegionState.draggingRegions) {
                const currentTrack = this._app.tracksController.getTrackById(item.region.trackId)!;

                // 1. Clone the region in its current (dropped) state
                const newRegion = item.region.clone();
                // ID must be unique
                newRegion.id = this.getNewId();

                copies.push({ region: newRegion, track: currentTrack });

                // 2. Prepare to restore original
                const originalTrack = this._app.tracksController.getTrackById(item.initialTrackId)!;
                originalsToRestore.push({ region: item.region, track: originalTrack, pos: item.initialPos });
            }

            // Restore originals immediately (cancel the move)
            originalsToRestore.forEach(op => this.moveRegion(op.region, op.track, op.pos));

            // Add copies
            this.doIt(true,
                () => {
                    copies.forEach(op => {
                        this.addRegion(op.track, op.region);
                        this.selection.add(op.region);
                    });
                },
                () => {
                    copies.forEach(op => {
                        this.removeRegion(op.region);
                    });
                }
            );

            // Select the new copies
            this.selection.set(null);
            copies.forEach(op => this.selection.add(op.region));

        } else {
            const moves: { region: RegionOf<any>, oldTrack: Track, oldX: number, newTrack: Track, newX: number }[] = [];

            for (const item of this.draggedRegionState.draggingRegions) {
                const oldTrack = this._app.tracksController.getTrackById(item.initialTrackId)!;
                const oldX = item.initialPos;
                const newTrack = this._app.tracksController.getTrackById(item.region.trackId)!;
                const newX = item.region.pos;

                if (oldTrack.id !== newTrack.id || Math.abs(oldX - newX) > 0.1) {
                    moves.push({ region: item.region, oldTrack, oldX, newTrack, newX });
                }
            }

            if (moves.length > 0) {
                this.doIt(true,
                    () => moves.forEach(m => this.moveRegion(m.region, m.newTrack, m.newX)),
                    () => moves.forEach(m => this.moveRegion(m.region, m.oldTrack, m.oldX))
                );
            }
        }

        this.draggedRegionState = undefined;
    }

    private updateSelectionFromBox(x: number, y: number, w: number, h: number) {
        const newInBox = new Set<RegionOf<any>>();
        this.tracks.forEach(track => {
            const waveform = this._editorView.getWaveFormViewById(track.id);
            if (!waveform) return;
            const waveY = waveform.y;
            const waveH = waveform.height;
            if (y < waveY + waveH && y + h > waveY) {
                track.regions.forEach(region => {
                    const view = waveform.getRegionViewById(region.id);
                    if (view) {
                        const rX = view.x;
                        const rW = view.width;
                        if (x < rX + rW && x + w > rX) { newInBox.add(region as RegionOf<any>); }
                    }
                });
            }
        });

        const finalSelection = new Set([...this._initialSelection, ...newInBox]);
        const current = new Set(this.selection.selecteds);

        for (const r of current) {
            if (!finalSelection.has(r)) this.selection.remove(r);
        }
        for (const r of finalSelection) {
            if (!current.has(r)) this.selection.add(r);
        }
    }

}