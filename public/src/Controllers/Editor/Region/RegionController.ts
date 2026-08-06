import { FederatedPointerEvent, Point, Graphics } from "pixi.js";
import App, { crashOnDebug } from "../../../App";
import { MIDI } from "../../../Audio/MIDI/MIDI";
import { HEIGHT_AUTOMATION, HEIGHT_TRACK, RATIO_MILLS_BY_PX, TEMPO } from "../../../Env";
import AutomationRegion, { AutomationPoint, CurveMode } from "../../../Models/Region/AutomationRegion";
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
import WaveformView from "../../../Views/Editor/WaveformView";
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
        automationPoints: { region: AutomationRegion, indices: Set<number>, initialPoints: AutomationPoint[] }[],
        totalDirection: number,
        minTimeDelta: number,
        maxTimeDelta: number
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
        }[],
        draggingAutomationPoints: {
            region: AutomationRegion,
            points: AutomationPoint[],
            indices: Set<number>
        }[],
        offsetX: number
    } | null = null; // ...

    // ... (skipping some lines) ...

    private handleRegionArrowPress(direction: number) {
        if (this._arrowMoveState) return;

        const regionsToMove: { region: RegionOf<any>, view: RegionView<any>, initialPos: number }[] = [];
        for (const region of this.selection.selecteds) {
            const view = this.getView(region);
            if (view) {
                regionsToMove.push({ region, view, initialPos: region.pos });
            }
        }

        // Capture Automation Points
        const automationPointsToMove: { region: AutomationRegion, indices: Set<number>, initialPoints: AutomationPoint[] }[] = [];
        this.selectedAutomationPoints.forEach((indices, region) => {
            if (indices.size > 0) {
                automationPointsToMove.push({
                    region: region,
                    indices: new Set(indices),
                    initialPoints: JSON.parse(JSON.stringify(region.points))
                });
            }
        });

        if (regionsToMove.length === 0 && automationPointsToMove.length === 0) return;

        // Calculate Wall Constraints for Automation Points
        let minTimeDelta = -Infinity;
        let maxTimeDelta = Infinity;

        for (const group of automationPointsToMove) {
            const points = group.initialPoints;
            const indices = group.indices;

            for (const idx of indices) {
                const currentP = points[idx];

                // Check Left Wall
                if (idx > 0 && !indices.has(idx - 1)) {
                    const leftNeighbor = points[idx - 1];
                    const limit = leftNeighbor.time - currentP.time;
                    minTimeDelta = Math.max(minTimeDelta, limit);
                } else if (idx === 0) {
                    const limit = -currentP.time;
                    minTimeDelta = Math.max(minTimeDelta, limit);
                }

                // Check Right Wall
                if (idx < points.length - 1 && !indices.has(idx + 1)) {
                    const rightNeighbor = points[idx + 1];
                    const limit = rightNeighbor.time - currentP.time;
                    maxTimeDelta = Math.min(maxTimeDelta, limit);
                }
            }
        }

        this._arrowMoveState = {
            regions: regionsToMove,
            automationPoints: automationPointsToMove,
            totalDirection: 0,
            minTimeDelta,
            maxTimeDelta
        };

        const stepMove = () => {
            if (!this._arrowMoveState) return;
            this._arrowMoveState.totalDirection += direction;
            const beatDurationMs = (60 / TEMPO) * 1000;
            let distanceMs = this._arrowMoveState.totalDirection * beatDurationMs;

            // Clamp distance based on automation constraints
            // (Only clamp if we have automation points moving, otherwise regions move freely?)
            // If we have BOTH, should automation constraints limit region movement?
            // "Sync" implies they move together. So yes, if points hit a wall, regions should probably stop too?
            // Or should regions detach? 
            // Dragging behavior: `handleAutomationPointDrag` clamps. `handleRegionDrag` does NOT clamp automation?
            // Wait, in `handleAutomationPointDrag`, if I hit a wall, everything stops.
            // In `handleRegionDrag` (pointer down), we just move. Automation points are offset. They might go negative or cross?
            // Usually `handleRegionDrag` doesn't check automation point collisions.
            // BUT, if we are moving via KEY, preventing overlap is good practice.
            // Let's apply clamp if automation points are present.

            if (this._arrowMoveState.automationPoints.length > 0) {
                distanceMs = Math.max(this._arrowMoveState.minTimeDelta, Math.min(this._arrowMoveState.maxTimeDelta, distanceMs));
            }
            // If only regions, no clamping (except maybe 0 start check done later)

            // TODO: This is still used for visual movement, but should be ms aware.

            for (const item of this._arrowMoveState.regions) {
                const currentStartMs = Math.max(0, item.region.start + distanceMs);
                item.view.position.x = this._app.msToX(currentStartMs);
            }

            for (const group of this._arrowMoveState.automationPoints) {
                const region = group.region;
                for (const idx of group.indices) {
                    const initialP = group.initialPoints[idx];
                    const p = region.points[idx] as AutomationPoint;
                    p.time = Math.max(0, initialP.time + distanceMs);
                }
                const view = this.getView(region);
                view?.redraw("", region);
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
        const state = this._arrowMoveState;
        this._arrowMoveState = null; // Clear state immediately to prevent re-entry

        if (state.totalDirection !== 0) {
            const beatDurationMs = (60 / TEMPO) * 1000;
            let distanceMs = state.totalDirection * beatDurationMs;

            if (state.automationPoints.length > 0) {
                distanceMs = Math.max(state.minTimeDelta, Math.min(state.maxTimeDelta, distanceMs));
            }


            const moves: { region: RegionOf<any>, oldTrack: Track, oldX: number, newTrack: Track, newX: number }[] = [];
            for (const item of state.regions) {
                const oldTrack = this._app.tracksController.getTrackById(item.region.trackId)!;
                const oldX = item.initialPos;
                const newStartMs = Math.max(0, item.region.start + distanceMs);
                const newX = this._app.msToX(newStartMs);
                // But wait, automation points are already updated in `stepMove`.
                // `doIt` for regions calls `moveRegion`, which does logic.
                // `doIt` for automation points just needs to set data?

                moves.push({ region: item.region, oldTrack, oldX, newTrack: oldTrack, newX });
            }

            const automationMoves = state.automationPoints;

            if (moves.length > 0 || automationMoves.length > 0) {
                this.doIt(true,
                    () => {
                        moves.forEach(m => this.moveRegion(m.region, m.newTrack, m.newX));

                        automationMoves.forEach(group => {
                            const region = group.region;
                            if (region.paramId) {
                                const t = this._app.tracksController.getTrackById(region.trackId);
                                if (t) t.automationData.set(region.paramId, region.points);
                            }
                            const view = this.getView(region);
                            view?.redraw("", region);
                        });
                    },
                    () => {
                        moves.slice().reverse().forEach(m => this.moveRegion(m.region, m.oldTrack, m.oldX));

                        automationMoves.forEach(group => {
                            const region = group.region;
                            region.points = JSON.parse(JSON.stringify(group.initialPoints)); // Restore
                            if (region.paramId) {
                                const t = this._app.tracksController.getTrackById(region.trackId);
                                if (t) t.automationData.set(region.paramId, region.points);
                            }
                            const view = this.getView(region);
                            view?.redraw("", region);
                        });
                    }
                );
            }
        }
    }

    // Removed handleAutomationArrowPress as it is merged into handleRegionArrowPress

    // Automation Selection State
    public selectedAutomationPoints: Map<AutomationRegion, Set<number>> = new Map();
    private draggedAutomationPointsState: {
        anchorRegion: AutomationRegion, // Changed from 'region' to be specific
        draggingPoints: {
            region: AutomationRegion,
            indices: number[], // indices being dragged specifically (usually all selected)
            initialPoints: AutomationPoint[]
        }[],
        draggingRegions: { // Regions to move with automation
            region: RegionOf<any>,
            initialPos: number
        }[],
        anchorIndex: number,
        initialAnchorTime: number // Store initial time for delta calculation
    } | null = null;

    // ... (constructor and bindEvents omitted from this replace block, handled separately or assumed correct)

    // ... (handleAutomationPointerDown) ...
    private lastSelectedAutomationPoint: { region: AutomationRegion, index: number } | null = null;
    private _lastAutomationPointClickTime: number = 0;
    private _lastClickedAutomationPoint: { region: AutomationRegion, index: number } | null = null;
    private _initialAutomationSelection: Map<AutomationRegion, Set<number>> = new Map();

    protected oldTrackWhenMoving!: Track;
    protected newTrackWhenMoving!: Track;
    private regionClipboard: { region: RegionOf<any>, track: Track } | null = null; // Added null for initialization
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

    // ペンモードでのオートメーション描画状態
    private _isDrawingAutomation: boolean = false;
    private _drawingAutomationState: {
        region: AutomationRegion;
        track: Track;
        view: AutomationRegionView;
        initialPoints: AutomationPoint[];
        lastAddedTime: number;
    } | null = null;
    private readonly AUTOMATION_DRAW_MIN_INTERVAL = 5; // 最小間隔（ピクセル相当のミリ秒）

    // Automation Drag State (Removed old draggedAutomationPoint)

    doIt: (undoable: boolean, redo: () => void, undo: () => void) => void; // Added type for doIt

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
        if (track && track.regions.indexOf(region) >= 0) crashOnDebug("Try to add a region already in the track")
        if (region.id === -1) region.id = this.getNewId()
        const factory = RegionController.regionViewFactories[region.regionType]!
        if (!factory) { crashOnDebug("No factory for region type " + region.regionType) }
        
        if (track) {
            track.addRegion(region)
            track.modified = true
        }

        let regionView = factory(this._editorView, region)
        this.bindRegionEvents(region, regionView)
        
        const color = track ? track.color : "#ffcc00"; // Default to BPM color if no track
        regionView.initializeRegionView(color, region)
        
        if (!waveform) {
            if (track) {
                waveform = this._editorView.getWaveFormViewById(track.id)!
            } else if (region.regionType === AutomationRegion.TYPE) {
                // Global BPM Automation case
                waveform = this._editorView.getWaveFormViewById(-1); // Use -1 as global ID
                if (!waveform) {
                    // Create a dummy waveform for global automation
                    waveform = new WaveformView(this._editorView, { id: -1, color: "#ffcc00" } as any);
                    this._editorView.addWaveformView(waveform);
                }
            }
        }
        
        if (waveform) {
            waveform.addChild(regionView)
            waveform.regionViews.push(regionView)
        }
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

    public hasSelection(): boolean { return !!this.selection.primary || this.selectedAutomationPoints.size > 0; }
    public hasClipboard(): boolean { return !!this.regionClipboard || !!this.automationClipboard; }



    bindRegionEvents(region: Region, regionView: RegionView<any>): void {
        regionView.on("pointermove", (e: FederatedPointerEvent) => {
            if (region instanceof AutomationRegion) {
                regionView.cursor = "default";
                return;
            }
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

            if (_e.button === 0 && !(region instanceof AutomationRegion)) {
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
            if (!(region instanceof AutomationRegion)) _e.stopPropagation();
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
                // Clear automation point selection too
                this.selectedAutomationPoints.forEach((indices, region) => {
                    indices.clear();
                    const view = this.getView(region) as AutomationRegionView;
                    if (view) { view.selectedPointIndices = new Set(); view.redraw("", region); }
                });
                this.selectedAutomationPoints.clear();
                this.lastSelectedAutomationPoint = null;
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
            // Check for automation selection first
            if ((this.hasSelection() || this.selectedAutomationPoints.size > 0) && (key === "ArrowLeft" || key === "ArrowRight") && !meta) {
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
                // Deep copy automation selection
                this._initialAutomationSelection = new Map();
                this.selectedAutomationPoints.forEach((indices, region) => {
                    this._initialAutomationSelection.set(region, new Set(indices));
                });
                this._selectionStart = this._editorView.viewport.toLocal(e.data.global);
                this.viewportAnimationLoopId = requestAnimationFrame(this.viewportAnimationLoop.bind(this));
                return;
            }

            this.viewportAnimationLoopId = requestAnimationFrame(this.viewportAnimationLoop.bind(this));

            if (App.TOOL_MODE === "SELECT") {
                this._isSelecting = true;
                this._initialSelection = new Set(this.selection.selecteds);
                // Deep copy automation selection
                this._initialAutomationSelection = new Map();
                this.selectedAutomationPoints.forEach((indices, region) => {
                    this._initialAutomationSelection.set(region, new Set(indices));
                });
                this._selectionStart = this._editorView.viewport.toLocal(e.data.global);

                // Deselect all only on left-click without modifiers
                if (e.button === 0 && !originalEvent.ctrlKey && !originalEvent.shiftKey) {
                    this.selection.set(null);
                    // Clear automation point selection too
                    this.selectedAutomationPoints.forEach((indices, region) => {
                        indices.clear();
                        const view = this.getView(region) as AutomationRegionView;
                        if (view) { view.selectedPointIndices = new Set(); view.redraw("", region); }
                    });
                    this.selectedAutomationPoints.clear();
                    this.lastSelectedAutomationPoint = null;
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
            // オートメーション描画中の処理
            if (this._isDrawingAutomation && this._drawingAutomationState) {
                this.handleAutomationDraw(e);
                return;
            }
            if (this.draggedAutomationPointsState) { // Changed from draggedAutomationPoint
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
            if (this.draggedAutomationPointsState) {
                const { anchorRegion, draggingPoints, anchorIndex, initialAnchorTime } = this.draggedAutomationPointsState;
                const track = this._app.tracksController.getTrackById(anchorRegion.trackId);
                const view = this.getView(anchorRegion) as AutomationRegionView;

                // Capture current state for redo
                const finalPoints = JSON.parse(JSON.stringify(anchorRegion.points));

                // Sort on release
                anchorRegion.points.sort((a, b) => a.time - b.time);

                // Re-calculate selected indices based on objects
                if (view && this.selectedAutomationPoints.has(anchorRegion)) {
                    const newSelected = new Set<number>();
                    // For each point that was dragged, find its new index after sorting
                    for (const group of draggingPoints) {
                        if (group.region === anchorRegion) { // Only re-select for the anchor region
                            for (const initialIdx of group.indices) {
                                const initialP = group.initialPoints[initialIdx];
                                // Find the point in the now sorted `anchorRegion.points` that corresponds to `initialP`
                                // This is tricky if points can have identical time/value.
                                // A more robust solution would be to assign unique IDs to automation points.
                                // For now, we'll rely on the fact that `handleAutomationPointDrag` updated points in place
                                // and `initialPoints` is a deep copy of the state *before* dragging.
                                // We need to find the point in `finalPoints` (the state *after* dragging but *before* sorting)
                                // and then find its index in the sorted `anchorRegion.points`.

                                // Let's simplify: the points in `anchorRegion.points` were modified in place.
                                // We just need to find the new indices of the points that were part of `draggingIndices`.
                                // This assumes that the points themselves (objects) are still the same, just their properties changed.
                                // After sorting, their indices might change.
                                const draggedPoint = anchorRegion.points.find(p =>
                                    (p as AutomationPoint).time === finalPoints[initialIdx].time &&
                                    (p as AutomationPoint).value === finalPoints[initialIdx].value
                                );
                                if (draggedPoint) {
                                    const newIndex = anchorRegion.points.indexOf(draggedPoint);
                                    if (newIndex !== -1) {
                                        newSelected.add(newIndex);
                                    }
                                }
                            }
                        }
                    }
                    this.selectedAutomationPoints.set(anchorRegion, newSelected);
                    view.selectedPointIndices = newSelected;
                }

                if (track && view) {
                    this.doIt(true,
                        () => {
                            // Already done (points updated in place and sorted)
                            if (anchorRegion.paramId) track.automationData.set(anchorRegion.paramId, anchorRegion.points);
                            view.redraw("", anchorRegion);
                            // Re-apply selection after redraw
                            if (this.selectedAutomationPoints.has(anchorRegion)) {
                                view.selectedPointIndices = this.selectedAutomationPoints.get(anchorRegion)!;
                                view.redraw("", anchorRegion);
                            }
                            track.updateAutomationIcon();
                        },
                        () => {
                            // Restore initial state for undo
                            for (const group of draggingPoints) {
                                group.region.points = JSON.parse(JSON.stringify(group.initialPoints));
                                if (group.region.paramId) {
                                    const t = this._app.tracksController.getTrackById(group.region.trackId);
                                    if (t) t.automationData.set(group.region.paramId, group.region.points);
                                }
                                const v = this.getView(group.region);
                                v?.redraw("", group.region);
                                this._app.tracksController.getTrackById(group.region.trackId)?.updateAutomationIcon();
                            }
                            // Restore selection state for undo
                            this.selectedAutomationPoints.clear();
                            for (const group of draggingPoints) {
                                const restoredSelected = new Set<number>();
                                for (const initialIdx of group.indices) {
                                    restoredSelected.add(initialIdx); // Original indices are valid for initialPoints
                                }
                                this.selectedAutomationPoints.set(group.region, restoredSelected);
                                const v = this.getView(group.region) as AutomationRegionView;
                                if (v) { v.selectedPointIndices = restoredSelected; v.redraw("", group.region); }
                            }
                        }
                    );
                }

                this.draggedAutomationPointsState = null;

                // 再生中ならストリーミングをリセット
                if (this._app.host.isPlaying) {
                    this._app.automationController.resetAutomationStreaming();
                }
                return;
            }

            // Removed old draggedAutomationPoint block

            // オートメーション描画終了時のUndo登録
            if (this._isDrawingAutomation && this._drawingAutomationState) {
                const { region, track, initialPoints } = this._drawingAutomationState;
                const finalPoints = JSON.parse(JSON.stringify(region.points)) as AutomationPoint[];

                // Undo/Redo登録（一括で戻す）
                this._app.addRedoUndo(
                    () => {
                        region.points = JSON.parse(JSON.stringify(finalPoints));
                        if (region.paramId) {
                            track.automationData.set(region.paramId, region.points);
                        }
                        const view = this.getView(region) as AutomationRegionView;
                        view?.redraw("", region);
                        track.updateAutomationIcon();
                    },
                    () => {
                        region.points = JSON.parse(JSON.stringify(initialPoints));
                        if (region.paramId) {
                            track.automationData.set(region.paramId, region.points);
                        }
                        const view = this.getView(region) as AutomationRegionView;
                        view?.redraw("", region);
                        track.updateAutomationIcon();
                    }
                );

                // データ同期
                if (region.paramId) {
                    track.automationData.set(region.paramId, region.points);
                }
                track.updateAutomationIcon();

                // 再生中ならストリーミングリセット
                if (this._app.host.isPlaying) {
                    this._app.automationController.resetAutomationStreaming();
                }

                this._isDrawingAutomation = false;
                this._drawingAutomationState = null;
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

                    // 最小サイズチェック（10px相当のミリ秒）
                    const MIN_REGION_DURATION = 10 * RATIO_MILLS_BY_PX;

                    if (region.midi.duration < MIN_REGION_DURATION) {
                        // 小さすぎるリージョンは削除
                        this.removeRegion(region);
                    } else {
                        // 有効なリージョンとして登録
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
                }
                this._newRegion = null;
                this._targetTrack = null;
            }
        });

        this._editorView.viewport.on("pointerupoutside", (e) => {
            if (this.draggedAutomationPointsState) { // Handle pointerupoutside for automation too
                this._editorView.viewport.emit("pointerup", e); // Delegate to pointerup logic
                return;
            }
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
                        // Range selection logic...
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
                    regionToDeselect = region; // Defer deselect to pointerup
                } else {
                    this.selection.add(region);
                }
            } else {
                if (!this.selection.isSelected(region)) {
                    this.selection.set(region);

                    // Clear automation point selection when selecting a new region (without modifiers)
                    // to prevent accidental synced movement of previously selected points.
                    this.selectedAutomationPoints.forEach((indices, r) => {
                        indices.clear();
                        const view = this.getView(r) as AutomationRegionView;
                        if (view) { view.selectedPointIndices = new Set(); view.redraw("", r); }
                    });
                    this.selectedAutomationPoints.clear();
                }
            }
            this._lastClickedRegion = { region, trackId: region.trackId };
        }

        if (e.button !== 0) return; // Only start drag if Left Click

        const toMove = region ?? this.selection.primary;
        const view = region ? regionView : this.getView(this.selection.primary);
        if (view && toMove) {
            this.selectedRegionEndOutsideViewport = view.position.x + view.width > this._editorView.viewport.right
            this.selectedRegionStartOutsideViewport = view.position.x < this._editorView.viewport.left;

            const draggingRegions: {
                region: RegionOf<any>,
                initialPos: number,
                initialTrackId: number,
                offsetMs: number
            }[] = [];

            for (const r of this.selection.selecteds) {
                draggingRegions.push({
                    region: r,
                    initialPos: r.pos,
                    initialTrackId: r.trackId,
                    offsetMs: r.start - toMove.start
                });
            }

            // Capture initial state of ALL selected automation points for synced movement
            const draggingAutomationPoints: { region: AutomationRegion, points: AutomationPoint[], indices: Set<number> }[] = [];

            this.selectedAutomationPoints.forEach((indices, region) => {
                if (indices.size > 0) {
                    draggingAutomationPoints.push({
                        region: region,
                        points: JSON.parse(JSON.stringify(region.points)),
                        indices: new Set(indices)
                    });
                }
            });

            this.draggedRegionState = {
                anchorRegion: toMove,
                initialAnchorPos: toMove.pos,
                initialGlobalX: e.global.x,
                initialViewportLeft: this._editorView.viewport.left,
                hasMoved: false,
                regionToDeselect: null,
                draggingRegions: draggingRegions,
                draggingAutomationPoints: draggingAutomationPoints,
                offsetX: e.global.x - view.position.x
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
        const track = region.trackId !== -1 ? this._app.tracksController.getTrackById(region.trackId) : undefined;
        const waveform = this._editorView.getWaveFormViewById(region.trackId);
        
        this.doIt(undoable,
            () => {
                if (track) {
                    track.removeRegionById(region.id);
                    track.modified = true;
                }
                const oldTrackId = region.trackId;
                region.trackId = -1;
                
                if (waveform) {
                    const view = waveform.getRegionViewById(region.id);
                    if (view) {
                        waveform.removeRegionView(view);
                    }
                }
                this.selection.remove(region);
                
                // Keep track ID for redo
                (region as any)._oldTrackId = oldTrackId;
            },
            () => { 
                const targetTrack = (region as any)._oldTrackId !== -1 ? this._app.tracksController.getTrackById((region as any)._oldTrackId) : null;
                this.addRegion(targetTrack as any, region); 
            }
        )
    }

    public deleteSelectedRegion(undoable: boolean): void {
        if (this.draggedRegionState) return;

        // Delete selected automation points
        this.selectedAutomationPoints.forEach((indices, region) => {
            if (indices.size > 0) {
                const track = this._app.tracksController.getTrackById(region.trackId);
                const view = this.getView(region) as AutomationRegionView;
                if (track && view) {
                    const originalPoints = JSON.parse(JSON.stringify(region.points));
                    const pointsToDelete = Array.from(indices).sort((a, b) => b - a); // Delete from end to avoid index issues
                    pointsToDelete.forEach(idx => region.points.splice(idx, 1));
                    region.points.sort((a, b) => (a as AutomationPoint).time - (b as AutomationPoint).time); // Re-sort after deletion
                    if (region.paramId) track.automationData.set(region.paramId, region.points);

                    this.selectedAutomationPoints.get(region)?.clear(); // Clear selection for this region
                    view.selectedPointIndices = new Set(); // Update view
                    view.redraw("", region); // Redraw AFTER clearing selection
                    track.updateAutomationIcon();
                    this.doIt(undoable,
                        () => { /* already done */ },
                        () => {
                            region.points = originalPoints;
                            if (region.paramId) track.automationData.set(region.paramId, originalPoints);
                            view.redraw("", region);
                            track.updateAutomationIcon();
                        }
                    );
                }
            }
        });
        this.selectedAutomationPoints.clear(); // Clear all automation point selections

        // Delete selected regions
        const toRemove = this.selection.selecteds.map(it => ({ region: it, track: it.trackId }))
        this.doIt(undoable,
            () => { toRemove.forEach(it => this.removeRegion(it.region)) },
            () => { toRemove.forEach(it => this.addRegion(this._app.tracksController.getTrackById(it.track)!, it.region)) }
        )
    }

    public selectAllRegions() {
        this.selection.set(null);

        // Clear automation point selection first (to reset view)
        this.selectedAutomationPoints.forEach((indices, region) => {
            indices.clear();
            const view = this.getView(region) as AutomationRegionView;
            if (view) { view.selectedPointIndices = new Set(); view.redraw("", region); }
        });
        this.selectedAutomationPoints.clear();

        for (const track of this.tracks) {
            // Select regular regions (exclude AutomationRegion)
            for (const region of track.regions) {
                if (!(region instanceof AutomationRegion)) {
                    this.selection.add(region as RegionOf<any>);
                }
            }

            // Select automation points if automation is opened
            if (track.isAutomationOpened) {
                for (const region of track.automationRegions) {
                    if (region.points.length > 0) {
                        const indices = new Set<number>();
                        for (let i = 0; i < region.points.length; i++) indices.add(i);

                        this.selectedAutomationPoints.set(region, indices);
                        const view = this.getView(region) as AutomationRegionView;
                        if (view) {
                            view.selectedPointIndices = indices;
                            view.redraw("", region);
                        }
                    }
                }
            }
        }
    }

    private automationClipboard: { points: AutomationPoint[], duration: number } | null = null;

    public copyRegion(region: RegionOf<any>, undoable = false) {
        const oldClipboard = this.regionClipboard
        const track = this._app.tracksController.getTrackById(region.trackId)
        if (!track) return;

        // Clear automation clipboard when copying region
        this.automationClipboard = null;

        this.doIt(undoable,
            () => { this.regionClipboard = { region: region.clone(), track: track! } },
            () => { this.regionClipboard = oldClipboard }
        )
    }

    public cutRegion(region: RegionOf<any>, undoable = false) {
        const oldClipboard = this.regionClipboard
        const track = this._app.tracksController.getTrackById(region.trackId)!

        // Clear automation clipboard when cutting region
        this.automationClipboard = null;

        this.doIt(undoable,
            () => { this.copyRegion(region, false); this.removeRegion(region) },
            () => { this.regionClipboard = oldClipboard; this.addRegion(track, region) }
        )
    }

    public cutSelectedRegion() {
        if (this.selectedAutomationPoints.size > 0) {
            this.cutSelectedAutomationPoints();
            return;
        }
        if (this.selection.primary) this.cutRegion(this.selection.primary, true);
    }

    public copySelectedRegion() {
        if (this.selectedAutomationPoints.size > 0) {
            this.copySelectedAutomationPoints();
            return;
        }
        if (this.selection.primary) this.copyRegion(this.selection.primary, true);
    }

    public pasteRegion(undoable: boolean = false, pasteAtX?: number) {
        if (this.automationClipboard) {
            this.pasteAutomationPoints(undoable, pasteAtX);
            return;
        }

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

    private copySelectedAutomationPoints() {
        const points: { p: AutomationPoint, region: AutomationRegion }[] = [];
        this.selectedAutomationPoints.forEach((indices, region) => {
            indices.forEach(idx => {
                points.push({ p: region.points[idx] as AutomationPoint, region });
            });
        });

        if (points.length === 0) return;

        // Sort by time
        points.sort((a, b) => a.p.time - b.p.time);

        const startMs = points[0].p.time;
        const endMs = points[points.length - 1].p.time;
        const duration = endMs - startMs;

        // Create relative points
        const copiedPoints = points.map(item => ({
            time: item.p.time - startMs,
            value: item.p.value,
            curve: item.p.curve
        }));

        this.automationClipboard = { points: copiedPoints, duration };
        this.regionClipboard = null; // Clear region clipboard
    }

    private cutSelectedAutomationPoints() {
        this.copySelectedAutomationPoints();
        this.deleteSelectedRegion(true); // Re-use delete logic which handles undo/redo
    }

    private pasteAutomationPoints(undoable: boolean, pasteAtX?: number) {
        if (!this.automationClipboard) return;

        let track = this._app.tracksController.selectedTrack;
        // If no track selected, try to find one? For now assume selected track.
        if (!track) return;

        // Determine paste starting time
        let pasteStart = this._app.host.playhead;
        if (pasteAtX !== undefined && this._editorView.viewport) {
            // pasteAtX is global clientX. 
            // We need to account for the canvas position on the screen.
            const canvasRect = this._editorView.canvasContainer.getBoundingClientRect();
            const canvasX = pasteAtX - canvasRect.left;

            const worldX = canvasX + this._editorView.viewport.left;
            pasteStart = worldX * RATIO_MILLS_BY_PX;
        }

        // Find region at pasteStart
        let targetRegion = track.regions.find(r => r instanceof AutomationRegion && r.start <= pasteStart && r.end >= pasteStart) as AutomationRegion;

        // If no region at pasteStart, try to find one close or just the first one?
        if (!targetRegion) {
            // Try to find any automation region on this track
            targetRegion = track.regions.find(r => r instanceof AutomationRegion) as AutomationRegion;
        }

        if (!targetRegion) return; // No automation region to paste into

        const view = this.getView(targetRegion) as AutomationRegionView;
        if (!view) return;

        const originalPoints = JSON.parse(JSON.stringify(targetRegion.points)); // For Undo

        const pasteEnd = pasteStart + this.automationClipboard.duration;

        // Filter out existing points in the paste range (Overwrite logic)
        const newPoints = targetRegion.points.filter(p => {
            const t = (p as AutomationPoint).time;
            // Remove points INSIDE the range [pasteStart, pasteEnd]
            // Using strict inequality for duration 0? 
            // If duration is 0, start == end. We remove point at start.
            return t < pasteStart || t > pasteEnd;
        });

        // Add pasted points
        this.automationClipboard.points.forEach(cp => {
            newPoints.push({
                time: pasteStart + cp.time,
                value: cp.value,
                curve: cp.curve
            });
        });

        // Sort
        newPoints.sort((a, b) => (a as AutomationPoint).time - (b as AutomationPoint).time);

        this.doIt(undoable,
            () => {
                targetRegion.points = newPoints;
                if (targetRegion.paramId) track!.automationData.set(targetRegion.paramId, newPoints);
                view.redraw("", targetRegion);
            },
            () => {
                targetRegion.points = originalPoints;
                if (targetRegion.paramId) track!.automationData.set(targetRegion.paramId, originalPoints);
                view.redraw("", targetRegion);
            }
        );
    }
    public splitSelectedRegion() {
        if (!this.selection.primary) return
        if (!this.isPlayheadOnSelectedRegion()) return
        let originalRegion = this.selection.primary
        const app = this._app;
        const regionStartX = app.msToX(originalRegion.start);
        const splitPositionX = app.editorView.playhead.position.x;
        const splitTime = app.xToMs(splitPositionX) - originalRegion.start;
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
                if (this.selection.primary === newRegion) this.selection.set(newRegion)
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
        const app = this._app;
        const playHeadPosX = app.editorView.playhead.position.x;
        const selectedRegionStartX = app.msToX(this.selection.primary.start);
        const selectedRegionEndX = app.msToX(this.selection.primary.end);
        return (playHeadPosX >= selectedRegionStartX && playHeadPosX <= selectedRegionEndX);
    }

    private updateDragPosition(globalX: number, globalY: number) {
        if (!this.draggedRegionState) return;

        const anchor = this.draggedRegionState.anchorRegion;

        // Calculate new X for Anchor
        const scrollDiff = this._editorView.viewport.left - this.draggedRegionState.initialViewportLeft;
        let newX = globalX - this.draggedRegionState.offsetX + scrollDiff;

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
        // Adjust globalY relative to viewport content.
        // Reverting the canvas offset substraction as PIXI events likely already handle this or it was incorrect.
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
        const anchorNewStartMs = this._app.xToMs(newX);

        for (const item of this.draggedRegionState.draggingRegions) {
            // Calculate New Track
            const itemInitialTrackIndex = tracks.findIndex(t => t.id === item.initialTrackId);
            let itemNewTrackIndex = itemInitialTrackIndex + trackIndexDelta;
            itemNewTrackIndex = Math.max(0, Math.min(tracks.length - 1, itemNewTrackIndex));
            const itemNewTrack = tracks.get(itemNewTrackIndex);

            // Calculate New Position
            const itemNewStartMs = Math.max(0, anchorNewStartMs + item.offsetMs);
            const itemNewX = this._app.msToX(itemNewStartMs);

            this.moveRegion(item.region, itemNewTrack, itemNewX);
        }

        // Sync Automation Points
        if (this.draggedRegionState.draggingAutomationPoints) {
            const initialAnchorTime = this._app.xToMs(this.draggedRegionState.initialAnchorPos);
            const deltaMs = anchorNewStartMs - initialAnchorTime;

            for (const item of this.draggedRegionState.draggingAutomationPoints) {
                const region = item.region;
                for (const idx of item.indices) { // Only iterate selected indices
                    const initialP = item.points[idx];
                    if (initialP) {
                        region.points[idx].time = Math.max(0, initialP.time + deltaMs);
                    }
                }
                if (region.paramId) {
                    const t = this._app.tracksController.getTrackById(region.trackId);
                    if (t) t.automationData.set(region.paramId, region.points);
                }
                const view = this.getView(region);
                view?.redraw("", region);
            }
        }
    }

    private handleAutomationPointerDown(e: FederatedPointerEvent, region: AutomationRegion, view: AutomationRegionView) {
        const local = view.toLocal(e.global);
        const height = HEIGHT_AUTOMATION;
        const DEFAULT_HIT_RADIUS = 8;
        const SELECTED_HIT_RADIUS = 12;
        const originalEvent = e.originalEvent as unknown as MouseEvent;

        // 右クリックの場合はポイント作成をスキップ（コンテキストメニュー用）
        // イベント伝播を停止して選択状態を保持
        if (e.button === 2) {
            e.stopPropagation();
            return; // ContextMenuController が処理する
        }

        // ペンモードの場合は、即座にオートメーション描画モードを開始
        const isPenMode = App.TOOL_MODE === "PEN";
        if (isPenMode && local.y >= 0 && local.y <= height) {
            const track = this._app.tracksController.getTrackById(region.trackId);
            if (track) {
                const absoluteX = local.x + view.position.x;
                const time = Math.max(0, this._app.xToMs(absoluteX));
                const value = Math.max(0, Math.min(1, 1 - (local.y / height)));

                // 初期状態を保存（Undo用）
                const initialPoints = JSON.parse(JSON.stringify(region.points)) as AutomationPoint[];

                // 描画開始位置にポイントを追加
                const newPoint: AutomationPoint = { time, value, curve: CurveMode.Linear };

                // 既存のポイントで同じ時間にあるものを削除
                region.points = region.points.filter(p => Math.abs(p.time - time) > this.AUTOMATION_DRAW_MIN_INTERVAL * RATIO_MILLS_BY_PX);
                region.points.push(newPoint);
                region.points.sort((a, b) => a.time - b.time);

                // 描画状態を設定
                this._isDrawingAutomation = true;
                this._drawingAutomationState = {
                    region: region,
                    track: track,
                    view: view,
                    initialPoints: initialPoints,
                    lastAddedTime: time
                };

                // 選択をクリア
                this.selectedAutomationPoints.clear();
                this.selection.set(null);

                view.redraw("", region);
                e.stopPropagation();
                return; // ペンモードでは他の処理をスキップ
            }
        }

        // Find closest point（ペンモード以外でのみ実行）
        let closestIndex = -1;
        let minDist = Infinity;

        if (!isPenMode) {
            for (let i = 0; i < region.points.length; i++) {
                const p = region.points[i] as AutomationPoint;
                const px = p.time / RATIO_MILLS_BY_PX;
                const py = (1 - p.value) * height;
                const dist = Math.sqrt((local.x - px) ** 2 + (local.y - py) ** 2);

                const currentIndices = this.selectedAutomationPoints.get(region);
                const isSelected = currentIndices ? currentIndices.has(i) : false;
                const radius = isSelected ? SELECTED_HIT_RADIUS : DEFAULT_HIT_RADIUS;

                if (dist < radius && dist < minDist) {
                    minDist = dist;
                    closestIndex = i;
                }
            }
        }

        if (closestIndex !== -1) {
            // Check for double click to reset to default
            // detail === 2 might not be reliable, so we also check time delta
            const isManualDoubleClick = (Date.now() - this._lastAutomationPointClickTime < 500) &&
                                       (this._lastClickedAutomationPoint?.region === region && this._lastClickedAutomationPoint?.index === closestIndex);
            
            if (originalEvent.detail === 2 || (e as any).detail === 2 || isManualDoubleClick) {
                this.resetSelectedAutomationPoints(region, closestIndex);
                this._lastAutomationPointClickTime = 0;
                this._lastClickedAutomationPoint = null;
                e.stopPropagation();
                return;
            }

            this._lastAutomationPointClickTime = Date.now();
            this._lastClickedAutomationPoint = { region, index: closestIndex };

            // Drag existing point
            const isShift = originalEvent.shiftKey;
            const isCtrl = originalEvent.ctrlKey || originalEvent.metaKey;
            let currentIndices = this.selectedAutomationPoints.get(region) || new Set<number>();

            if (isShift) {
                if (this.lastSelectedAutomationPoint && this.lastSelectedAutomationPoint.region === region) {
                    // Range Selection
                    const startIdx = this.lastSelectedAutomationPoint.index;
                    const endIdx = closestIndex;
                    const startP = region.points[startIdx] as AutomationPoint;
                    const endP = region.points[endIdx] as AutomationPoint;
                    const minTime = Math.min(startP.time, endP.time);
                    const maxTime = Math.max(startP.time, endP.time);
                    const minValue = Math.min(startP.value, endP.value);
                    const maxValue = Math.max(startP.value, endP.value);

                    // Select all points inside
                    for (let i = 0; i < region.points.length; i++) {
                        const p = region.points[i] as AutomationPoint;
                        if (p.time >= minTime && p.time <= maxTime &&
                            p.value >= minValue && p.value <= maxValue) {
                            currentIndices.add(i);
                        }
                    }
                } else {
                    currentIndices.add(closestIndex);
                    this.lastSelectedAutomationPoint = { region, index: closestIndex };
                }
            } else if (isCtrl) {
                if (currentIndices.has(closestIndex)) {
                    currentIndices.delete(closestIndex);
                    if (this.lastSelectedAutomationPoint?.index === closestIndex && this.lastSelectedAutomationPoint?.region === region) {
                        this.lastSelectedAutomationPoint = null;
                    }
                } else {
                    currentIndices.add(closestIndex);
                    this.lastSelectedAutomationPoint = { region, index: closestIndex };
                }
            } else {
                // If single click
                if (!currentIndices.has(closestIndex)) {
                    // Reset selection if clicking unselected
                    this.selectedAutomationPoints.forEach((inds, r) => {
                        if (r !== region) {
                            inds.clear();
                            // force redraw?
                            const view = this.getView(r) as AutomationRegionView;
                            if (view) { view.selectedPointIndices = new Set(); view.redraw("", r); }
                        }
                    });
                    this.selectedAutomationPoints.clear();

                    // Clear region selection as requested by user to prevent accidental sync move
                    this.selection.set(null);

                    currentIndices.clear();
                    currentIndices.add(closestIndex);
                    this.lastSelectedAutomationPoint = { region, index: closestIndex };
                } else {
                    this.lastSelectedAutomationPoint = { region, index: closestIndex };
                }
            }

            if (currentIndices.size > 0) {
                this.selectedAutomationPoints.set(region, currentIndices);
            } else {
                this.selectedAutomationPoints.delete(region);
            }
            view.selectedPointIndices = currentIndices;
            view.redraw("", region);

            // Setup Drag State
            const draggingPoints: { region: AutomationRegion, indices: number[], initialPoints: AutomationPoint[] }[] = [];
            // Add ALL selected points from ALL regions
            this.selectedAutomationPoints.forEach((indices, r) => {
                if (indices.size > 0) {
                    draggingPoints.push({
                        region: r,
                        indices: Array.from(indices),
                        initialPoints: JSON.parse(JSON.stringify(r.points))
                    });
                }
            });

            // Add selected regions for sync move
            const draggingRegions = this.selection.selecteds.map(r => ({
                region: r,
                initialPos: r.start
            }));

            this.draggedAutomationPointsState = {
                anchorRegion: region,
                draggingPoints,
                draggingRegions,
                anchorIndex: closestIndex,
                initialAnchorTime: (region.points[closestIndex] as AutomationPoint).time
            };

            e.stopPropagation(); // Handle event here
            return;
        }

        // Check if click is on the line
        const sortedPoints = [...region.points].sort((a, b) => (a as AutomationPoint).time - (b as AutomationPoint).time);

        let onLine = false;

        if (sortedPoints.length > 0) {
            // Check Left Extension
            const firstP = sortedPoints[0] as AutomationPoint;
            const firstX = firstP.time / RATIO_MILLS_BY_PX;
            const firstY = (1 - firstP.value) * height;

            if (local.x < firstX) {
                if (Math.abs(local.y - firstY) < DEFAULT_HIT_RADIUS) {
                    onLine = true;
                }
            }

            // Check segments
            if (!onLine) {
                for (let i = 0; i < sortedPoints.length - 1; i++) {
                    const p1 = sortedPoints[i] as AutomationPoint;
                    const p2 = sortedPoints[i + 1] as AutomationPoint;

                    const x1 = p1.time / RATIO_MILLS_BY_PX;
                    const y1 = (1 - p1.value) * height;
                    const x2 = p2.time / RATIO_MILLS_BY_PX;
                    const y2 = (1 - p2.value) * height;

                    const l2 = (x1 - x2) ** 2 + (y1 - y2) ** 2;
                    if (l2 === 0) continue;

                    let t = ((local.x - x1) * (x2 - x1) + (local.y - y1) * (y2 - y1)) / l2;
                    t = Math.max(0, Math.min(1, t));

                    const px = x1 + t * (x2 - x1);
                    const py = y1 + t * (y2 - y1);

                    const dist = Math.sqrt((local.x - px) ** 2 + (local.y - py) ** 2);

                    if (dist < DEFAULT_HIT_RADIUS) {
                        onLine = true;
                        break;
                    }
                }
            }
        } else {
            // If no points, allow creating a point anywhere on the automation lane
            onLine = true;
        }

        // ペンモードで空白エリアでも描画開始可能 (isPenModeは上部で既に宣言済み)
        const canDraw = onLine || (isPenMode && local.y >= 0 && local.y <= height);

        if (canDraw) {
            // Add new point
            const time = Math.max(0, local.x * RATIO_MILLS_BY_PX);
            const value = Math.max(0, Math.min(1, 1 - (local.y / height)));

            // ペンモードでのオートメーション描画を開始
            if (isPenMode) {
                const track = this._app.tracksController.getTrackById(region.trackId);
                if (track) {
                    // 初期状態を保存（Undo用）
                    const initialPoints = JSON.parse(JSON.stringify(region.points)) as AutomationPoint[];

                    // 描画開始位置にポイントを追加
                    const newPoint: AutomationPoint = { time, value, curve: CurveMode.Linear };

                    // 既存のポイントで同じ時間にあるものを削除
                    region.points = region.points.filter(p => Math.abs(p.time - time) > this.AUTOMATION_DRAW_MIN_INTERVAL * RATIO_MILLS_BY_PX);
                    region.points.push(newPoint);
                    region.points.sort((a, b) => a.time - b.time);

                    // 描画状態を設定
                    this._isDrawingAutomation = true;
                    this._drawingAutomationState = {
                        region: region,
                        track: track,
                        view: view,
                        initialPoints: initialPoints,
                        lastAddedTime: time
                    };

                    // 選択をクリア
                    this.selectedAutomationPoints.clear();
                    this.selection.set(null);

                    view.redraw("", region);
                    e.stopPropagation();
                    return;
                }
            }

            // 通常のポイント作成（選択モード等）
            // 新規ポイントのカーブモードは、前のポイントのモードを継承
            let inheritedCurve: CurveMode = CurveMode.Linear;
            const sortedPoints = [...region.points].sort((a, b) => a.time - b.time);
            for (let i = sortedPoints.length - 1; i >= 0; i--) {
                if (sortedPoints[i].time < time) {
                    inheritedCurve = sortedPoints[i].curve ?? CurveMode.Linear;
                    break;
                }
            }

            const newPoint: AutomationPoint = { time, value, curve: inheritedCurve };

            region.points.push(newPoint);
            region.points.sort((a, b) => (a as AutomationPoint).time - (b as AutomationPoint).time);

            closestIndex = region.points.indexOf(newPoint);

            // auto-select new point
            const currentIndices = new Set<number>();
            currentIndices.add(closestIndex);

            this.selectedAutomationPoints.forEach((inds, r) => {
                if (r !== region) {
                    inds.clear();
                    const view = this.getView(r) as AutomationRegionView;
                    if (view) { view.selectedPointIndices = new Set(); view.redraw("", r); }
                }
            });
            this.selectedAutomationPoints.clear();

            // Clear region selection when creating new point
            this.selection.set(null);

            this.selectedAutomationPoints.set(region, currentIndices);
            view.selectedPointIndices = currentIndices;

            const draggingPoints = [{
                region: region,
                indices: [closestIndex],
                initialPoints: JSON.parse(JSON.stringify(region.points))
            }];

            this.draggedAutomationPointsState = {
                anchorRegion: region,
                draggingPoints,
                draggingRegions: [], // No regions should move when creating a new point
                anchorIndex: closestIndex,
                initialAnchorTime: newPoint.time
            };

            view.redraw("", region);
            e.stopPropagation(); // Handle event here
        }

        // If not on line and not on point, do NOT stop propagation.
        // This allows EditorView/Viewport to handle it (e.g. for selection box).
    }

    private handleAutomationPointDrag(e: FederatedPointerEvent) {
        if (!this.draggedAutomationPointsState) return;

        const { anchorRegion, draggingPoints, draggingRegions, anchorIndex, initialAnchorTime } = this.draggedAutomationPointsState;
        const view = this.getView(anchorRegion);
        if (!view) return;

        const local = view.toLocal(e.data.global);
        const height = HEIGHT_AUTOMATION;

        // Calculate Target info for Anchor
        let targetTime = Math.max(0, local.x * RATIO_MILLS_BY_PX);

        if (this._editorView.snapping && !this.snappingDisabled) {
            const cellSizeMs = this._editorView.cellSize * RATIO_MILLS_BY_PX;
            targetTime = Math.round(targetTime / cellSizeMs) * cellSizeMs;
        }

        // BPM 動的スケーリング処理
        const isBpmRegion = anchorRegion === this._app.host.bpmAutomationRegion;
        if (isBpmRegion) {
            const host = this._app.host;
            const oldMin = host.bpmMinDisplay;
            const oldMax = host.bpmMaxDisplay;
            const yRatio = local.y / height; // 0 (top) to 1 (bottom)
            const targetBpm = oldMax - yRatio * (oldMax - oldMin);

            if (targetBpm > oldMax || targetBpm < oldMin) {
                host.updateBpmDisplayRange(targetBpm < oldMin ? targetBpm : undefined, targetBpm > oldMax ? targetBpm : undefined);
                const newMin = host.bpmMinDisplay;
                const newMax = host.bpmMaxDisplay;

                // スケールが変わったので、ドラッグ開始時の基準点 (initialPoints) も再正規化して同期させる
                draggingPoints.forEach(group => {
                    if (group.region === host.bpmAutomationRegion) {
                        group.initialPoints.forEach(p => {
                            const absBpm = oldMin + p.value * (oldMax - oldMin);
                            p.value = (absBpm - newMin) / (newMax - newMin);
                        });
                    }
                });
            }
        }

        const targetValue = Math.max(0, Math.min(1, 1 - (local.y / height)));

        // Calculate Deltas based on Anchor
        let timeDelta = targetTime - initialAnchorTime;

        // Find anchor initial point in draggingPoints to get value delta
        // The anchorRegion IS one of the draggingPoints regions.
        const anchorGroup = draggingPoints.find(dp => dp.region === anchorRegion);
        if (!anchorGroup) return; // Should not happen
        const anchorInitial = anchorGroup.initialPoints[anchorIndex];

        const valueDelta = targetValue - anchorInitial.value;

        // Calculate Time Constraints (Walls) - Global Check
        let minTimeDelta = -Infinity;
        let maxTimeDelta = Infinity;

        // We check constraints for ALL moving points
        for (const group of draggingPoints) {
            const initialPoints = group.initialPoints;
            const draggingIndices = group.indices;
            const draggingSet = new Set(draggingIndices);

            for (const idx of draggingIndices) {
                const currentP = initialPoints[idx];

                // Check Left Wall
                if (idx > 0 && !draggingSet.has(idx - 1)) {
                    const leftNeighbor = initialPoints[idx - 1];
                    const limit = leftNeighbor.time - currentP.time;
                    minTimeDelta = Math.max(minTimeDelta, limit);
                } else if (idx === 0) {
                    const limit = -currentP.time;
                    minTimeDelta = Math.max(minTimeDelta, limit);
                }

                // Check Right Wall
                if (idx < initialPoints.length - 1 && !draggingSet.has(idx + 1)) {
                    const rightNeighbor = initialPoints[idx + 1];
                    const limit = rightNeighbor.time - currentP.time;
                    maxTimeDelta = Math.min(maxTimeDelta, limit);
                }
            }
        }

        // Clamp timeDelta
        timeDelta = Math.max(minTimeDelta, Math.min(maxTimeDelta, timeDelta));

        // Apply to all Automation Points
        for (const group of draggingPoints) {
            const region = group.region;
            const initialPoints = group.initialPoints;
            const draggingIndices = group.indices;

            for (const idx of draggingIndices) {
                const initP = initialPoints[idx];
                let newTime = initP.time + timeDelta;
                let newValue = initP.value + valueDelta; // Value delta applies to all? or mapped? Typically same delta.

                newTime = Math.max(0, newTime);
                newValue = Math.max(0, Math.min(1, newValue));

                (region.points[idx] as AutomationPoint).time = newTime;
                (region.points[idx] as AutomationPoint).value = newValue; // Apply value delta only to anchor? 
                // Usually multi-select moves same value delta.
            }

            if (region.paramId) {
                const t = this._app.tracksController.getTrackById(region.trackId);
                if (t) t.automationData.set(region.paramId, region.points);
            }
            const v = this.getView(region);
            v?.redraw("", region);
        }

        // Sync Regions
        for (const item of draggingRegions) {
            const newStartMs = Math.max(0, item.initialPos + timeDelta);

            // Directly update region position to avoid remove/add cycle which causes flickering/disappearing
            item.region.start = newStartMs;

            const view = this.getView(item.region);
            if (view) {
                view.position.x = newStartMs / RATIO_MILLS_BY_PX;
                // Redraw view (needed if loop or other visuals depend on position, though usually x update is enough for container)
                // view.redraw(...) // Optional if just moving X
            }

            const track = this._app.tracksController.getTrackById(item.region.trackId);
            if (track) track.modified = true;
        }
    }

    /**
     * ペンモードでオートメーションを描画中にドラッグでポイントを連続追加
     */
    private handleAutomationDraw(e: FederatedPointerEvent): void {
        if (!this._drawingAutomationState) return;

        const { region, view, lastAddedTime } = this._drawingAutomationState;
        const local = view.toLocal(e.data.global);
        const height = HEIGHT_AUTOMATION;

        const time = Math.max(0, local.x * RATIO_MILLS_BY_PX);

        // BPM 動的スケーリング処理 (ペンモード)
        if (region === this._app.host.bpmAutomationRegion) {
            const host = this._app.host;
            const oldMin = host.bpmMinDisplay;
            const oldMax = host.bpmMaxDisplay;
            const yRatio = local.y / height;
            const targetBpm = oldMax - yRatio * (oldMax - oldMin);

            if (targetBpm > oldMax || targetBpm < oldMin) {
                host.updateBpmDisplayRange(targetBpm < oldMin ? targetBpm : undefined, targetBpm > oldMax ? targetBpm : undefined);
                const newMin = host.bpmMinDisplay;
                const newMax = host.bpmMaxDisplay;

                // 描画開始時の初期状態 (initialPoints) も再正規化する
                this._drawingAutomationState.initialPoints.forEach(p => {
                    const absBpm = oldMin + p.value * (oldMax - oldMin);
                    p.value = (absBpm - newMin) / (newMax - newMin);
                    p.value = Math.max(0, Math.min(1, p.value));
                });
            }
        }

        const value = Math.max(0, Math.min(1, 1 - (local.y / height)));

        // 最小間隔をチェック（ピクセル相当）
        const minInterval = this.AUTOMATION_DRAW_MIN_INTERVAL * RATIO_MILLS_BY_PX;
        if (Math.abs(time - lastAddedTime) < minInterval) {
            return; // 間隔が短すぎるのでスキップ
        }

        // 描画方向を判定（右方向か左方向か）
        const isMovingRight = time > lastAddedTime;

        // 既存のポイントで、lastAddedTime と time の間にあるものを削除（上書き）
        const minTime = Math.min(lastAddedTime, time);
        const maxTime = Math.max(lastAddedTime, time);

        region.points = region.points.filter(p => {
            // lastAddedTime 自体（またはそれに極めて近い点）は、
            // 前回の描画確定点なので残す（削除しない）
            if (Math.abs(p.time - lastAddedTime) < 1.0) return true;

            // それ以外の範囲内（minTime ～ maxTime）のポイントは削除
            // つまり、前回と今回の間にあった既存ポイントを上書き消去
            if (p.time >= minTime && p.time <= maxTime) return false;

            return true;
        });

        // 新しいポイントを追加
        const newPoint: AutomationPoint = { time, value, curve: CurveMode.Linear };
        region.points.push(newPoint);
        region.points.sort((a, b) => a.time - b.time);

        // 状態を更新
        this._drawingAutomationState.lastAddedTime = time;

        // 再描画
        view.redraw("", region);
    }

    private handlePointerMove(e: FederatedPointerEvent): void {
        if (!this.draggedRegionState) return;

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
                regionToAdd = originalRegion.clone() as RegionOf<any>;
                
                if (mode === 'LEFT') {
                    const diff = newStartMs - initialStart;
                    // Shrink or extend from left.
                    // The offset shifts along with the start.
                    // Note: We prevent extending to the left beyond the beginning of the source data (offset 0).
                    const newOffset = Math.max(0, regionToAdd.offset + diff);
                    const actualDiff = newOffset - regionToAdd.offset;
                    
                    regionToAdd.start = initialStart + actualDiff;
                    regionToAdd.offset = newOffset;
                    
                    const initialEnd = initialStart + initialDuration;
                    (regionToAdd as any)._customDuration = Math.max(10, initialEnd - regionToAdd.start);
                } else { // RIGHT
                    // Start and offset remain the same, only duration changes.
                    const diff = newDurationMs - initialDuration;
                    (regionToAdd as any)._customDuration = Math.max(10, initialDuration + diff);
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

            this.draggedRegionState = null;
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

        this.draggedRegionState = null;
    }

    private updateSelectionFromBox(x: number, y: number, w: number, h: number) {
        const newInBox = new Set<RegionOf<any>>();
        const newSelectedAutomationPoints = new Map<AutomationRegion, Set<number>>();
        const isShift = isKeyPressed("Shift");

        // オートメーションビューを更新するためのヘルパー
        const updateAutoView = (region: AutomationRegion, indices: Set<number>) => {
            const track = this._app.tracksController.getTrackById(region.trackId);
            if (track) {
                const waveform = this._editorView.getWaveFormViewById(track.id);
                if (waveform) {
                    const view = waveform.getRegionViewById(region.id) as AutomationRegionView;
                    if (view) {
                        view.selectedPointIndices = indices;
                        view.redraw("", region);
                    }
                }
            }
        };

        this.tracks.forEach(track => {
            const waveform = this._editorView.getWaveFormViewById(track.id);
            if (!waveform) return;
            const waveY = waveform.y;
            const trackHeight = HEIGHT_TRACK;

            // 1. 通常のリージョン（トラック領域との交差をチェック）
            if (y < waveY + trackHeight && y + h > waveY) {
                track.regions.forEach(region => {
                    if (region instanceof AutomationRegion) return;
                    const view = waveform.getRegionViewById(region.id);
                    if (view) {
                        const rX = view.x;
                        const rW = view.width;
                        if (x < rX + rW && x + w > rX) {
                            newInBox.add(region as RegionOf<any>);
                        }
                    }
                });
            }

            // 2. オートメーションポイント（オートメーションレーンとの交差をチェック）
            if (track.isAutomationOpened) {
                for (let i = 0; i < track.automationRegions.length; i++) {
                    const region = track.automationRegions[i];
                    const view = waveform.getRegionViewById(region.id) as AutomationRegionView;

                    if (view) {
                        const autoRegionY = waveY + trackHeight + (i * HEIGHT_AUTOMATION);

                        if (y < autoRegionY + HEIGHT_AUTOMATION && y + h > autoRegionY) {
                            const indicesInBox = new Set<number>();

                            for (let j = 0; j < region.points.length; j++) {
                                const p = region.points[j];
                                const pVx = view.x + p.time / RATIO_MILLS_BY_PX;
                                const pVy = autoRegionY + (1 - p.value) * HEIGHT_AUTOMATION;

                                if (pVx >= x && pVx <= x + w && pVy >= y && pVy <= y + h) {
                                    indicesInBox.add(j);
                                }
                            }

                            // Shift押下時は初期選択状態とマージ
                            let finalIndices = new Set<number>();
                            if (isShift) {
                                const initial = this._initialAutomationSelection.get(region);
                                if (initial) {
                                    initial.forEach(idx => finalIndices.add(idx));
                                }
                            }
                            indicesInBox.forEach(idx => finalIndices.add(idx));

                            if (finalIndices.size > 0) {
                                newSelectedAutomationPoints.set(region, finalIndices);
                            }
                        } else if (isShift) {
                            // 矩形外だがShift押下時は初期状態を維持
                            const initial = this._initialAutomationSelection.get(region);
                            if (initial && initial.size > 0) {
                                newSelectedAutomationPoints.set(region, new Set(initial));
                            }
                        }
                    }
                }
            }
        });

        // 標準リージョンの選択更新
        const finalSelection = new Set([...this._initialSelection, ...newInBox]);
        const current = new Set(this.selection.selecteds);
        for (const r of current) { if (!finalSelection.has(r)) this.selection.remove(r); }
        for (const r of finalSelection) { if (!current.has(r)) this.selection.add(r); }

        // オートメーションポイントの選択更新
        this.selectedAutomationPoints.forEach((indices, region) => {
            if (!newSelectedAutomationPoints.has(region)) {
                updateAutoView(region, new Set());
            }
        });

        this.selectedAutomationPoints = newSelectedAutomationPoints;
        this.selectedAutomationPoints.forEach((indices, region) => {
            updateAutoView(region, indices);
        });
    }

    /**
     * 指定されたスクリーン座標がオートメーション線部分（ポイント以外）にあるかチェックし、
     * ある場合はそのセグメント情報を返す
     */
    public getAutomationContextAtPosition(clientX: number, clientY: number): { segmentIndex: number, region: AutomationRegion, track: Track } | null {
        const editorContainer = this._editorView.canvasContainer;
        if (!editorContainer) return null;

        const rect = editorContainer.getBoundingClientRect();
        if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) {
            return null;
        }

        // Viewport のスクロール量を考慮してワールド座標に変換
        const canvasX = clientX - rect.left;
        const canvasY = clientY - rect.top;
        const worldX = canvasX - this._editorView.viewport.position.x;
        const worldY = canvasY - this._editorView.viewport.position.y;

        const DEFAULT_HIT_RADIUS = 5;

        // 各トラックを調べる
        for (const track of this.tracks) {
            if (!track.isAutomationOpened || track.automationRegions.length === 0) continue;

            const waveform = this._editorView.getWaveFormViewById(track.id);
            if (!waveform) continue;

            const baseAutomationY = waveform.y + HEIGHT_TRACK;
            const automationHeight = HEIGHT_AUTOMATION;

            // どのレーンにあるかチェック
            for (let rIdx = 0; rIdx < track.automationRegions.length; rIdx++) {
                const region = track.automationRegions[rIdx];
                const regionTop = baseAutomationY + (rIdx * automationHeight);
                const regionBottom = regionTop + automationHeight;

                if (worldY >= regionTop && worldY <= regionBottom) {
                    const localX = worldX - waveform.x;
                    const localY = worldY - regionTop;

                    // 線のセグメントを調べる
                    const sortedPoints = [...region.points].sort((a, b) => a.time - b.time);

                    for (let i = 0; i < sortedPoints.length - 1; i++) {
                        const p1 = sortedPoints[i];
                        const p2 = sortedPoints[i + 1];

                        const x1 = p1.time / RATIO_MILLS_BY_PX;
                        const y1 = (1 - p1.value) * automationHeight;
                        const x2 = p2.time / RATIO_MILLS_BY_PX;
                        const y2 = (1 - p2.value) * automationHeight;

                        // 範囲外ならスキップ (X軸)
                        if (localX < Math.min(x1, x2) - DEFAULT_HIT_RADIUS || localX > Math.max(x1, x2) + DEFAULT_HIT_RADIUS) continue;

                        const curveMode = p1.curve ?? CurveMode.Linear;
                        let isHit = false;

                        if (curveMode === CurveMode.Step) {
                            // 水平
                            if (localX >= x1 && localX <= x2 && Math.abs(localY - y1) < DEFAULT_HIT_RADIUS) isHit = true;
                            // 垂直 (次のポイントの直前でジャンプする場合) -> Stepの実装によるが、一般的には「階段状」
                            // 今回の実装では「次のポイントまで値を維持」なので水平線のみでOKだが、終端での接続線がある場合も考慮。
                            // 垂直線 (x2, y1) -> (x2, y2)
                            if (!isHit && Math.abs(localX - x2) < DEFAULT_HIT_RADIUS) {
                                const minY = Math.min(y1, y2);
                                const maxY = Math.max(y1, y2);
                                if (localY >= minY && localY <= maxY) isHit = true;
                            }
                        } else {
                            // 線分との距離
                            const l2 = (x1 - x2) ** 2 + (y1 - y2) ** 2;
                            if (l2 === 0) {
                                isHit = Math.sqrt((localX - x1) ** 2 + (localY - y1) ** 2) < DEFAULT_HIT_RADIUS;
                            } else {
                                let t = ((localX - x1) * (x2 - x1) + (localY - y1) * (y2 - y1)) / l2;
                                t = Math.max(0, Math.min(1, t));
                                const px = x1 + t * (x2 - x1);
                                const py = y1 + t * (y2 - y1);
                                if (Math.sqrt((localX - px) ** 2 + (localY - py) ** 2) < DEFAULT_HIT_RADIUS) isHit = true;
                            }
                        }

                        if (isHit) {
                            const segmentIndex = region.points.indexOf(p1);
                            return { segmentIndex, region, track };
                        }
                    }
                }
            }
        }
        return null;
    }

    /**
     * 選択されたオートメーションポイントをデフォルト値にリセットする
     */
    private async resetSelectedAutomationPoints(region: AutomationRegion, clickedIndex: number) {
        const track = this._app.tracksController.getTrackById(region.trackId);
        if (!track || !region.paramId) return;

        const defaultValue = await this._app.automationController.getParameterDefaultValue(track, region.paramId);
        const originalPoints = JSON.parse(JSON.stringify(region.points)) as AutomationPoint[];
        
        // リセット対象のポイントを決定
        const targetIndices = new Set<number>();
        const currentSelected = this.selectedAutomationPoints.get(region);

        if (currentSelected && currentSelected.has(clickedIndex)) {
            // クリックされたポイントが選択中なら、全選択ポイントをリセット
            currentSelected.forEach(idx => targetIndices.add(idx));
        } else {
            // そうでなければクリックされたポイントのみリセット
            targetIndices.add(clickedIndex);
        }

        if (targetIndices.size === 0) return;

        const newPoints = JSON.parse(JSON.stringify(region.points)) as AutomationPoint[];
        targetIndices.forEach(idx => {
            if (newPoints[idx]) {
                newPoints[idx].value = defaultValue;
            }
        });

        const redo = () => {
            region.points = JSON.parse(JSON.stringify(newPoints));
            if (region.paramId) track.automationData.set(region.paramId, region.points);
            const view = this.getView(region) as AutomationRegionView;
            view?.redraw("", region);
            track.updateAutomationIcon();
            if (this._app.host.isPlaying) this._app.automationController.resetAutomationStreaming();
        };

        const undo = () => {
            region.points = JSON.parse(JSON.stringify(originalPoints));
            if (region.paramId) track.automationData.set(region.paramId, region.points);
            const view = this.getView(region) as AutomationRegionView;
            view?.redraw("", region);
            track.updateAutomationIcon();
            if (this._app.host.isPlaying) this._app.automationController.resetAutomationStreaming();
        };

        this.doIt(true, redo, undo);
    }
}
