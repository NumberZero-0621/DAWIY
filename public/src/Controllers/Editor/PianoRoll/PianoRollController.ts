import { Container, FederatedPointerEvent, Point, Rectangle, Graphics } from "pixi.js";
import App from "../../../App";
import MIDIRegion from "../../../Models/Region/MIDIRegion";
import Track from "../../../Models/Track/Track";
import PianoRollView from "../../../Views/Editor/PianoRoll/PianoRollView";
import { MIDINote } from "../../../Audio/MIDI/MIDI";
import { RATIO_MILLS_BY_PX, ZOOM_LEVEL, TEMPO } from "../../../Env";
import { audioCtx } from "../../../index";
import { RegionOf } from "../../../Models/Region/Region";
import { lightenColor } from "../../../Utils/Color";
import { isKeyPressed } from "../../../Utils/keys";

export default class PianoRollController {
    
    private _app: App;
    private _view: PianoRollView;
    private _track: Track | null = null;
    private _isVisible: boolean = false;
    private _selectedNotes: Set<MIDINote> = new Set();
    private _clipboard: { note: MIDINote, startOffset: number }[] = [];

    // Interaction state
    private _draggedNote: { 
        initialX: number, 
        initialY: number, 
        initialScrollX: number,
        originGlobalStart: number,
        notes: { note: MIDINote, region: MIDIRegion, initialStart: number, initialNote: number, graphic: any, duration: number }[],
        noteToDeselect: MIDINote | null,
        clickedInitialNote: number
    } | null = null;
    private _isDragging: boolean = false;
    private _isDraggingPlayhead: boolean = false;
    private _lastMousePos: Point = new Point();
    private _dragGhosts: any[] = [];
    
    // Audio Preview State
    private _lastPreviewedNote: number | null = null;

    // Resize state
    private _isResizing: boolean = false;
    private _resizeState: {
        mode: 'LEFT' | 'RIGHT';
        initialX: number;
        initialScrollX: number;
        notes: { note: MIDINote, region: MIDIRegion, initialStart: number, initialDuration: number, graphic: any }[];
    } | null = null;
    private readonly RESIZE_ZONE = 5;

    // Creation state
    private _creationState: {
        start: number;
        note: number;
        initialX: number;
        ghost: Graphics;
    } | null = null;

    // Selection state
    private _isSelecting: boolean = false;
    private _selectionStart: Point = new Point();
    private _lastClickedNote: { note: MIDINote, globalStart: number } | null = null;
    
    // Timeline Range Selection
    private _rangeSelectionStart: number | null = null;
    private _isRangeSelecting: boolean = false;
    private _timelinePointerDown: boolean = false;
    private _rangeStart: number | null = null;
    private _rangeEnd: number | null = null;
    private _resizeMode: 'LEFT' | 'RIGHT' | null = null;
    private _isMovingRange: boolean = false;
    private _dragOffset: number = 0;

    private _lastMoveEvent: FederatedPointerEvent | null = null;
    private scrollingLeft: boolean = false;
    private scrollingRight: boolean = false;
    private incrementScrollSpeed: number = 0;
    private viewportAnimationLoopId: number = 0;

    private _arrowKeyTimer: any = null;
    private _arrowKeyInterval: any = null;
    private _arrowMoveState: {
        notes: { note: MIDINote, region: MIDIRegion, initialStart: number, initialNote: number, graphic: any }[],
        totalDirection: number
    } | null = null;

    private _arrowVerticalKeyTimer: any = null;
    private _arrowVerticalKeyInterval: any = null;
    private _arrowVerticalMoveState: {
        notes: { note: MIDINote, region: MIDIRegion, initialStart: number, initialNote: number, graphic: any }[],
        totalShift: number
    } | null = null;

    // Loop State
    private _loopHandleType: 'LEFT' | 'RIGHT' | 'BODY' | null = null;
    private _isMovingLoop: boolean = false;
    private _loopDragOffset: number = 0;

    constructor(app: App) {
        this._app = app;
        this._view = new PianoRollView();
        
        // Hide by default
        this._view.visible = false;
        
        // Add to main stage (overlay)
        this._app.editorView.stage.addChild(this._view);

        this._app.host.onPlayHeadMove.add((pos, movedByPlayer) => {
            if (this._isVisible && this._view.visible) {
                const playheadX = pos / RATIO_MILLS_BY_PX;
                this._view.setPlayheadPosition(playheadX);

                if (movedByPlayer) {
                    const viewportWidth = this._view.viewportWidth;
                    const scrollX = this._view.scrollX;
                    const center = viewportWidth / 2;

                    const viewportLeft = scrollX;
                    const viewportRight = scrollX + viewportWidth;
                    const viewportCenter = scrollX + center;

                    const previousPlayheadX = (pos - 500) / RATIO_MILLS_BY_PX;

                    let targetScrollX = scrollX;

                    // 1. Tracking: Playhead crosses center
                    if (previousPlayheadX <= viewportCenter && playheadX >= viewportCenter) {
                        targetScrollX = playheadX - center;
                    }
                    // 2. Off-screen Right (or just keep centering if we are in tracking mode/past center?)
                    // Note: The crossing condition above handles the transition. 
                    // But if we are already far past center?
                    // The PlayheadController logic relies on the "previous <= center" check which might fail if we are already locked.
                    // But if we are locked, we set scrollX so that playheadX == viewportCenter.
                    // So next frame previousPlayheadX < viewportCenter (because viewport moved).
                    // So it should sustain itself.
                    
                    // 3. Off-screen Check (Jump if invisible)
                    else if (playheadX > viewportRight || playheadX < viewportLeft) {
                        targetScrollX = playheadX - center;
                    }

                    targetScrollX = Math.max(0, targetScrollX);

                    if (targetScrollX !== scrollX) {
                        this._view.updateScroll(targetScrollX - scrollX, 0);
                    }
                } else {
                    const PADDING = 50; // px
                    const viewportWidth = this._view.viewportWidth;
                    const scrollX = this._view.scrollX;
                    const viewportLeft = scrollX;
                    const viewportRight = scrollX + viewportWidth;

                    let targetScrollX = scrollX;

                    if (playheadX > viewportRight) {
                        // Jump viewport so playhead is at right edge minus padding
                        targetScrollX = playheadX - viewportWidth + PADDING;
                    }
                    else if (playheadX < viewportLeft) {
                        // Jump viewport so playhead is at left edge plus padding
                        targetScrollX = Math.max(0, playheadX - PADDING);
                    }

                    targetScrollX = Math.max(0, targetScrollX);

                    if (targetScrollX !== scrollX) {
                        this._view.updateScroll(targetScrollX - scrollX, 0);
                    }
                }
            }
        });

        this._app.tracksController.afterSelectedChange.add((_prev, current) => {
            if (this._isVisible && current instanceof Track) {
                this._track = current;
                this._selectedNotes.clear();
                this.redraw();
            }
        });

        this.bindEvents();
    }

    private handleNoteArrowPress(direction: number) {
        if (this._arrowMoveState) return;

        const notesToMove: { note: MIDINote, region: MIDIRegion, initialStart: number, initialNote: number, graphic: any }[] = [];
        const processedNotes = new Set<MIDINote>();
        for (const child of this._view.notesContainer.children as any[]) {
            if (child.noteData && this._selectedNotes.has(child.noteData.note) && !processedNotes.has(child.noteData.note)) {
                processedNotes.add(child.noteData.note);
                notesToMove.push({
                    note: child.noteData.note,
                    region: child.noteData.region,
                    initialStart: child.noteData.start,
                    initialNote: child.noteData.note.note,
                    graphic: child
                });
            }
        }
        if (notesToMove.length === 0) return;

        this._arrowMoveState = {
            notes: notesToMove,
            totalDirection: 0
        };

        const stepMove = () => {
            if (!this._arrowMoveState) return;
            this._arrowMoveState.totalDirection += direction;
            const beatDurationMs = (60 / TEMPO) * 1000;
            const distanceMs = this._arrowMoveState.totalDirection * beatDurationMs;

            for (const item of this._arrowMoveState.notes) {
                const newGlobalStart = (item.region.start + item.initialStart) + distanceMs;
                item.graphic.position.x = newGlobalStart / RATIO_MILLS_BY_PX;
            }
        };
        
        stepMove();

        this._arrowKeyTimer = setTimeout(() => {
            this._arrowKeyInterval = setInterval(stepMove, 50);
        }, 500);
    }
        
    private stopNoteArrowRepeat() {
        clearTimeout(this._arrowKeyTimer);
        clearInterval(this._arrowKeyInterval);
        this._arrowKeyTimer = null;
        this._arrowKeyInterval = null;

        if (!this._arrowMoveState) return;

        if (this._arrowMoveState.totalDirection !== 0) {
            const beatDurationMs = (60 / TEMPO) * 1000;
            const distanceMs = this._arrowMoveState.totalDirection * beatDurationMs;

            this.executeWithUndo(() => {
                const newSelection = new Set<MIDINote>();
                for (const item of this._arrowMoveState!.notes) {
                    const newGlobalStart = Math.max(0, (item.region.start + item.initialStart) + distanceMs);
                    this._deleteNoteInternal(item.region, item.note, item.initialStart);
                    const addedNote = this._addNoteInternal(item.initialNote, newGlobalStart, item.note.duration);
                    if (addedNote) newSelection.add(addedNote);
                }
                this._selectedNotes = newSelection;
            });
        }
        
        this._arrowMoveState = null;
    }

    private handleNoteVerticalArrowPress(shift: number) {
        if (this._arrowVerticalMoveState) return;

        const notesToMove: { note: MIDINote, region: MIDIRegion, initialStart: number, initialNote: number, graphic: any }[] = [];
        const processedNotes = new Set<MIDINote>();
        for (const child of this._view.notesContainer.children as any[]) {
            if (child.noteData && this._selectedNotes.has(child.noteData.note) && !processedNotes.has(child.noteData.note)) {
                processedNotes.add(child.noteData.note);
                notesToMove.push({
                    note: child.noteData.note,
                    region: child.noteData.region,
                    initialStart: child.noteData.start,
                    initialNote: child.noteData.note.note,
                    graphic: child
                });
            }
        }
        if (notesToMove.length === 0) return;

        this._arrowVerticalMoveState = {
            notes: notesToMove,
            totalShift: 0
        };

        const stepMove = () => {
            if (!this._arrowVerticalMoveState) return;
            this._arrowVerticalMoveState.totalShift += shift;

            for (const item of this._arrowVerticalMoveState.notes) {
                const newNoteVal = Math.max(0, Math.min(127, item.initialNote + this._arrowVerticalMoveState.totalShift));
                const newY = (127 - newNoteVal) * this._view.NOTE_HEIGHT;
                item.graphic.position.y = newY;
            }
            
             if (this._arrowVerticalMoveState.notes.length > 0) {
                 const leader = this._arrowVerticalMoveState.notes[0];
                 const newNoteVal = Math.max(0, Math.min(127, leader.initialNote + this._arrowVerticalMoveState.totalShift));
                 this.previewNote(newNoteVal);
             }
        };
        
        stepMove();

        this._arrowVerticalKeyTimer = setTimeout(() => {
            this._arrowVerticalKeyInterval = setInterval(stepMove, 100);
        }, 500);
    }
        
    private stopNoteVerticalArrowRepeat() {
        this.stopPreview();
        clearTimeout(this._arrowVerticalKeyTimer);
        clearInterval(this._arrowVerticalKeyInterval);
        this._arrowVerticalKeyTimer = null;
        this._arrowVerticalKeyInterval = null;

        if (!this._arrowVerticalMoveState) return;

        if (this._arrowVerticalMoveState.totalShift !== 0) {
            const shift = this._arrowVerticalMoveState.totalShift;

            this.executeWithUndo(() => {
                const newSelection = new Set<MIDINote>();
                for (const item of this._arrowVerticalMoveState!.notes) {
                    const newNoteVal = Math.max(0, Math.min(127, item.initialNote + shift));
                    const globalStart = item.region.start + item.initialStart;
                    
                    this._deleteNoteInternal(item.region, item.note, item.initialStart);
                    const addedNote = this._addNoteInternal(newNoteVal, globalStart, item.note.duration);
                    if (addedNote) newSelection.add(addedNote);
                }
                this._selectedNotes = newSelection;
                this.redraw();
            });
        }
        
        this._arrowVerticalMoveState = null;
    }

    private handleZoom(multiplier: number) {
        this._app.contextMenuController.hide();

        const currentRatio = RATIO_MILLS_BY_PX;
        const playheadMs = this._app.host.playhead;
        const scrollX = this._view.scrollX;

        const playheadScreenX = (playheadMs / currentRatio) - scrollX;

        this._app.editorController.zoomTo(ZOOM_LEVEL * multiplier);

        const nextRatio = RATIO_MILLS_BY_PX;
        const newPlayheadX = playheadMs / nextRatio;
        const newScrollX = Math.max(0, newPlayheadX - playheadScreenX);

        this._view.updateScroll(newScrollX - scrollX, 0);
    }

    public open(region: MIDIRegion) {
        // Resolve track from region
        const track = this._app.tracksController.getTrackById(region.trackId);
        if (!track) return;

        this._track = track;
        this._isVisible = true;
        this._view.visible = true;
        
        // Resize to full screen overlay
        this.resize();
        
        // Initial draw
        this.redraw();

        // Center view roughly on middle C (60)
        this._view.scrollY = (127 - 60) * this._view.NOTE_HEIGHT - this._view.viewportHeight / 2;
        
        // Scroll to the region start initially
        this._view.scrollX = region.start / RATIO_MILLS_BY_PX;
        this._view.updateScroll(0, 0);

        // Sync playhead
        const playheadX = this._app.host.playhead / RATIO_MILLS_BY_PX;
        this._view.setPlayheadPosition(playheadX);

        // Sync Range Selection
        const range = this._app.playheadController.getRangePx();
        if (range) {
            this.setRange(range.start, range.end, true);
        }
        
        this.redrawLoop();
    }

    public get isVisible(): boolean { return this._isVisible; }

    public resize() {
        if (!this._isVisible) return;

        let width = this._app.editorView.screen.width;
        let height = this._app.editorView.screen.height;

        // NEW LOGIC: Add the hidden height of the plugin panel
        // We want the piano roll to fill the space "behind" the plugin panel.
        // The plugin panel takes up space in the layout, shrinking the editor view.
        // We calculate how much space it's taking and add it back to the height passed to the view.
        
        const pluginEditor = document.getElementById("plugin-editor");
        if (pluginEditor) {
             const currentPluginHeight = pluginEditor.clientHeight;
             const collapsedHeight = 25; // From PluginsView.ts
             const hiddenHeight = Math.max(0, currentPluginHeight - collapsedHeight);
             height += hiddenHeight;
        }

        // Check for Audio Loop Browser (Sidebar)
        const browser = this._app.hostView.audioLoopBrowserDiv;
        if (browser && browser.offsetParent !== null) { // Checks if visible
             // Assuming browser is on the right
             width -= browser.offsetWidth;
        }

        this._view.resize(width, height);
    }

    public close() {
        this.stopPreview();
        this._isVisible = false;
        this._view.visible = false;
        this._track = null;
        this._selectedNotes.clear();
        this._isSelecting = false;
        this._view.clearSelectionBox();
        // Do NOT clear the global range on close, just the creation ghost
        if (this._creationState) {
            this._creationState.ghost.destroy();
            this._creationState = null;
        }
    }

    public setRange(start: number, end: number, fromSync: boolean = false) {
        this._rangeStart = start;
        this._rangeEnd = end;
        this._view.drawRangeSelection(start, end - start);
        
        if (!fromSync && this._app.playheadController) {
            this._app.playheadController.setRange(start, end, true);
        }
    }

    public clearRange(fromSync: boolean = false) {
        this._rangeStart = null;
        this._rangeEnd = null;
        this._view.clearRangeSelection();
        
        if (!fromSync && this._app.playheadController) {
            this._app.playheadController.clearRange(true);
        }
    }

    private updateNoteSelection() {
         if (this._rangeStart === null || this._rangeEnd === null) return;
         
         const startMs = this._rangeStart * RATIO_MILLS_BY_PX;
         const endMs = this._rangeEnd * RATIO_MILLS_BY_PX;
         
         this._selectedNotes.clear();
         if (this._track) {
             for (const region of this._track.regions) {
                 if (region instanceof MIDIRegion) {
                     region.midi.forEachNote((note, start) => {
                         const globalStart = region.start + start;
                         if (globalStart < endMs && globalStart + note.duration > startMs) {
                             this._selectedNotes.add(note);
                         }
                     });
                 }
             }
         }
         this.redraw();
    }

    public redraw() {
        if (!this._track) return;
        
        let color = 0xFF0000; // Default red
        if (this._track.color) {
            color = parseInt(this._track.color.replace("#", ""), 16);
        }

        // Calculate track duration
        let trackDuration = 0;
        for (const region of this._track.regions) {
            if (region.end > trackDuration) {
                trackDuration = region.end;
            }
        }

        // Get Time Signature and Tempo
        const timeSig = this._app.hostView.metronome.timeSignature || [4, 4];
        
        // Draw grid
        this._view.drawGrid(
            Math.max(trackDuration, 300000), 
            timeSig, 
            TEMPO, 
            this._app.editorView.snapResolution, 
            this._app.editorView.snapTriplet
        ); 
        this._view.drawNotes(this._track, color, this._selectedNotes);
        this.redrawLoop();
    }

    private updateTrack() {
        if (this._track) {
            this._track.update(audioCtx);
            this._track.modified = true;
        }
    }

    private viewportAnimationLoop() {
        if (!this._isVisible) return;

        const isActive = this._isDragging || this._isResizing || this._isSelecting || this._creationState || this._isDraggingPlayhead || this._timelinePointerDown || this._isMovingLoop;
        
        if (!isActive) {
            this.scrollingLeft = false;
            this.scrollingRight = false;
            return; 
        }

        if (this.scrollingLeft || this.scrollingRight) {
             const speed = this.incrementScrollSpeed; 
             
             let dx = 0;
             if (this.scrollingRight) dx = speed;
             if (this.scrollingLeft) dx = -speed;
             
             if (dx !== 0) {
                 this._view.updateScroll(dx, 0);
                 
                 // Reuse _lastMousePos
                 const globalPos = this._lastMousePos;
                 
                 // 1. Selection
                 if (this._isSelecting) {
                     const localPos = this._view.contentContainer.toLocal(globalPos);
                     const x = Math.min(this._selectionStart.x, localPos.x);
                     const y = Math.min(this._selectionStart.y, localPos.y);
                     const w = Math.abs(this._selectionStart.x - localPos.x);
                     const h = Math.abs(this._selectionStart.y - localPos.y);
                     
                     this._view.drawSelectionBox(x, y, w, h);
                     this.updateSelectionFromBox(x, y, w, h);
                     
                     let color = 0xFF0000;
                     if (this._track && this._track.color) color = parseInt(this._track.color.replace("#", ""), 16);
                     this._view.refreshNoteSelection(this._selectedNotes, color);
                 }
                 
                 // 2. Creation
                 if (this._creationState) {
                      const localPos = this._view.notesContainer.toLocal(globalPos);
                      let targetX = localPos.x;
                      targetX = this.snap(targetX);
                      
                      const targetTime = Math.max(0, targetX * RATIO_MILLS_BY_PX);
                      const anchorTime = this._creationState.start;
                      const startTime = Math.min(anchorTime, targetTime);
                      const endTime = Math.max(anchorTime, targetTime);
                      const duration = Math.max(0, endTime - startTime);
                      
                      const x = startTime / RATIO_MILLS_BY_PX;
                      const w = Math.max(1, duration / RATIO_MILLS_BY_PX);
                      
                      this._creationState.ghost.clear();
                      let color = 0xFF0000;
                      if (this._track && this._track.color) color = parseInt(this._track.color.replace("#", ""), 16);
                      this._creationState.ghost.beginFill(color, 0.5);
                      this._creationState.ghost.lineStyle(1, 0xFFFFFF);
                      this._creationState.ghost.drawRect(0, 0, w, this._view.NOTE_HEIGHT);
                      this._creationState.ghost.endFill();
                      this._creationState.ghost.position.set(x, (127 - this._creationState.note) * this._view.NOTE_HEIGHT);
                 }
                 
                 // 3. Dragging
                 if (this._isDragging && this._draggedNote) {
                      const scrollDelta = (this._view.scrollX - this._draggedNote.initialScrollX) * RATIO_MILLS_BY_PX;
                      const dx = globalPos.x - this._draggedNote.initialX;
                      const rawDt = dx * RATIO_MILLS_BY_PX + scrollDelta;
                      
                      const originCurrent = this._draggedNote.originGlobalStart + rawDt;
                      let originSnappedX = Math.max(0, originCurrent) / RATIO_MILLS_BY_PX;
                      originSnappedX = this.snap(originSnappedX);
                      const originSnappedGlobalStart = originSnappedX * RATIO_MILLS_BY_PX;
                      const effectiveDt = originSnappedGlobalStart - this._draggedNote.originGlobalStart;

                      const dy = globalPos.y - this._draggedNote.initialY;
                      const dNote = -Math.round(dy / this._view.NOTE_HEIGHT);

                      for (const item of this._draggedNote.notes) {
                          const globalStart = item.region.start + item.initialStart + effectiveDt;
                          let newGlobalStart = Math.max(0, globalStart);
                          let newX = newGlobalStart / RATIO_MILLS_BY_PX;
                          
                          const newNoteVal = Math.max(0, Math.min(127, item.initialNote + dNote));
                          const newY = (127 - newNoteVal) * this._view.NOTE_HEIGHT;
                          
                          item.graphic.position.set(newX, newY);
                      }
                 }
                 
                 // 4. Resizing
                 if (this._isResizing && this._resizeState) {
                    const scrollDelta = (this._view.scrollX - this._resizeState.initialScrollX) * RATIO_MILLS_BY_PX;
                    const dx = globalPos.x - this._resizeState.initialX;
                    const rawDt = dx * RATIO_MILLS_BY_PX + scrollDelta;

                    for (const item of this._resizeState.notes) {
                        const originalGlobalStart = item.region.start + item.initialStart;
                        const originalGlobalEnd = originalGlobalStart + item.initialDuration;

                        if (this._resizeState.mode === 'RIGHT') {
                            const newRawEnd = originalGlobalEnd + rawDt;
                            let newSnappedEndX = newRawEnd / RATIO_MILLS_BY_PX;
                            newSnappedEndX = this.snap(newSnappedEndX);
                            const newSnappedEnd = newSnappedEndX * RATIO_MILLS_BY_PX;
                            let newDuration = Math.max(RATIO_MILLS_BY_PX * 2, newSnappedEnd - originalGlobalStart);
                            const newW = newDuration / RATIO_MILLS_BY_PX;
                            item.graphic.width = newW;
                        } else {
                            const newRawStart = originalGlobalStart + rawDt;
                            let newSnappedStartX = newRawStart / RATIO_MILLS_BY_PX;
                            newSnappedStartX = this.snap(newSnappedStartX);
                            const newSnappedStart = Math.max(0, newSnappedStartX * RATIO_MILLS_BY_PX);
                            
                            let newDuration = Math.max(RATIO_MILLS_BY_PX * 2, originalGlobalEnd - newSnappedStart);
                            const effectiveStart = originalGlobalEnd - newDuration;
                            
                            const newX = effectiveStart / RATIO_MILLS_BY_PX;
                            const newW = newDuration / RATIO_MILLS_BY_PX;
                            item.graphic.x = newX;
                            item.graphic.width = newW;
                        }
                    }
                 }

                 // 5. Loop Moving
                 if (this._isMovingLoop && this._loopHandleType) {
                     const localPos = this._view.loopContainer.toLocal(globalPos);
                     let targetX = localPos.x;
                     if (!isKeyPressed("Shift")) {
                        targetX = this.snap(targetX);
                     }

                     const currentLoop = this._app.host.loopRange || [0, 0];
                     let start = currentLoop[0] / RATIO_MILLS_BY_PX;
                     let end = currentLoop[1] / RATIO_MILLS_BY_PX;
                     
                     if (this._loopHandleType === 'LEFT') {
                         start = targetX;
                         if (start > end) start = end;
                         start = Math.max(0, start);
                     } else if (this._loopHandleType === 'RIGHT') {
                         end = targetX;
                         if (end < start) end = start;
                     } else if (this._loopHandleType === 'BODY') {
                         const duration = end - start;
                         start = targetX - this._loopDragOffset;
                         if (start < 0) start = 0;
                         end = start + duration;
                     }
                     
                     this._app.hostController.setLoop([start * RATIO_MILLS_BY_PX, end * RATIO_MILLS_BY_PX]);
                     this.redrawLoop();
                 }
             }
        }
        
        this.viewportAnimationLoopId = requestAnimationFrame(this.viewportAnimationLoop.bind(this));
    }

    private checkIfScrollingNeeded(globalX: number) {
        if (!this._view || !this._view.visible) return;
        
        const viewportWidth = this._view.viewportWidth;
        const localPos = this._view.toLocal(new Point(globalX, 0));
        const SCROLL_ZONE = 50;
        
        this.scrollingRight = localPos.x >= viewportWidth - SCROLL_ZONE;
        this.scrollingLeft = localPos.x <= SCROLL_ZONE;
        
        if (this.scrollingRight) {
             const dist = localPos.x - (viewportWidth - SCROLL_ZONE);
             this.incrementScrollSpeed = Math.min(20, Math.max(2, dist / 2));
        } else if (this.scrollingLeft) {
             const dist = SCROLL_ZONE - localPos.x;
             this.incrementScrollSpeed = Math.min(20, Math.max(2, dist / 2));
        }
    }

    private snap(val: number): number {
        if (this._app.editorView.snapping) {
            const cellSize = this._app.editorView.cellSize;
            return Math.round(val / cellSize) * cellSize;
        }
        return val;
    }

    public hasSelection(): boolean { return this._selectedNotes.size > 0; }
    public hasClipboard(): boolean { return this._clipboard.length > 0; }

    private bindEvents() {
        // Window Resize
        window.addEventListener("resize", () => {
            if (this._isVisible) this.resize();
        });

        // Sidebar Toggle
        // Use a slight delay to allow the DOM to update its layout property (display/width)
        this._app.hostView.soundLoopBtn.addEventListener("click", () => {
            setTimeout(() => {
                if (this._isVisible) this.resize();
            }, 50); 
        });

        window.addEventListener("keyup", (e) => {
            if (!this._isVisible) return;
            if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
                this.stopNoteArrowRepeat();
            }
            if (e.key === "ArrowUp" || e.key === "ArrowDown") {
                this.stopNoteVerticalArrowRepeat();
            }
        }, true);

        // Keyboard Shortcuts (Capture phase to priority over global listeners)
        window.addEventListener("keydown", (e) => {
            if (!this._isVisible || !this._track) return;

            // Allow input in text fields (including those in Shadow DOM)
            const path = e.composedPath();
            if (path.length > 0) {
                const target = path[0] as HTMLElement;
                if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) {
                    // Deselect notes as requested to avoid confusion and side effects
                    if (this._selectedNotes.size > 0) {
                        this._selectedNotes.clear();
                        this.redraw();
                    }
                    return;
                }
            }

            if (this.hasSelection() && (e.key === "ArrowLeft" || e.key === "ArrowRight") && !e.ctrlKey && !e.metaKey) {
                const direction = e.key === "ArrowRight" ? 1 : -1;
                this.handleNoteArrowPress(direction);
                e.preventDefault();
                e.stopImmediatePropagation();
                return;
            }

            if (this.hasSelection() && (e.key === "ArrowUp" || e.key === "ArrowDown") && !e.ctrlKey && !e.metaKey) {
                const shift = e.key === "ArrowUp" ? 1 : -1;
                this.handleNoteVerticalArrowPress(shift);
                e.preventDefault();
                e.stopImmediatePropagation();
                return;
            }

            if (e.key === "Escape") {
                this._app.contextMenuController.hide();
                if (this._creationState) {
                    this._creationState.ghost.destroy();
                    this._creationState = null;
                } else {
                    this.close();
                }
                e.preventDefault();
                e.stopImmediatePropagation();
                return;
            }

            // Delete
            if (e.key === "Delete" || e.key === "Backspace") {
                this._app.contextMenuController.hide();
                this.deleteSelectedNotes();
                e.preventDefault();
                e.stopImmediatePropagation();
                return;
            }

            // Copy
            if ((e.ctrlKey || e.metaKey) && e.key === "c") {
                this._app.contextMenuController.hide();
                this.copySelectedNotes();
                e.preventDefault();
                e.stopImmediatePropagation();
                return;
            }

            // Cut
            if ((e.ctrlKey || e.metaKey) && e.key === "x") {
                this._app.contextMenuController.hide();
                this.cutSelectedNotes();
                e.preventDefault();
                e.stopImmediatePropagation();
                return;
            }

            // Paste
            if ((e.ctrlKey || e.metaKey) && e.key === "v") {
                this._app.contextMenuController.hide();
                this.pasteNotes();
                e.preventDefault();
                e.stopImmediatePropagation();
                return;
            }

            // Zoom In (Ctrl + Right Arrow)
            if ((e.ctrlKey || e.metaKey) && e.key === "ArrowRight") {
                this.handleZoom(1.5);
                e.preventDefault();
                e.stopImmediatePropagation();
                return;
            }

            // Zoom Out (Ctrl + Left Arrow)
            if ((e.ctrlKey || e.metaKey) && e.key === "ArrowLeft") {
                this.handleZoom(1 / 1.5);
                e.preventDefault();
                e.stopImmediatePropagation();
                return;
            }

            // Select All (Ctrl + A)
            if ((e.ctrlKey || e.metaKey) && (e.key === "a" || e.key === "A")) {
                this._app.contextMenuController.hide();
                this.selectAllNotes();
                e.preventDefault();
                e.stopImmediatePropagation();
                return;
            }
        }, true);

        // Wheel to scroll
        this._view.on("wheel", (e: any) => {
            if (!this._isVisible) return;
            // e.deltaY is usually 100 or -100
            this._view.updateScroll(e.deltaX, e.deltaY);
        });

        // Close Button
        this._view.closeButton.on("pointerdown", (e: FederatedPointerEvent) => {
            if (e.button === 0) {
                this.close();
                e.stopPropagation();
            }
        });

        // Loop Handles Interaction
        const bindLoopHandle = (handle: any, type: 'LEFT' | 'RIGHT') => {
            handle.on("pointerdown", (e: FederatedPointerEvent) => {
                if (e.button !== 0) return;
                this._isMovingLoop = true;
                this._loopHandleType = type;
                this._lastMousePos.copyFrom(e.global);
                e.stopPropagation();
                this.viewportAnimationLoopId = requestAnimationFrame(this.viewportAnimationLoop.bind(this));
            });
        };
        bindLoopHandle(this._view.loopHandleLeft, 'LEFT');
        bindLoopHandle(this._view.loopHandleRight, 'RIGHT');

        this._view.loopBar.on("pointerdown", (e: FederatedPointerEvent) => {
             if (this._isMovingLoop) return; 
             const localPos = e.getLocalPosition(this._view.loopContainer);
             
             const px = localPos.x;
             // Use hostController.loopRange to allow dragging even if inactive
             const loopRange = this._app.hostController.loopRange || [0, 0];
             const startPx = loopRange[0] / RATIO_MILLS_BY_PX;
             const endPx = loopRange[1] / RATIO_MILLS_BY_PX;
             
             // Check if clicking on the bar
             // Use loopRange from controller to validate hit
             if (px >= startPx && px <= endPx) {
                 this._isMovingLoop = true;
                 this._loopHandleType = 'BODY';
                 this._loopDragOffset = px - startPx;
                 this._lastMousePos.copyFrom(e.global);
                 e.stopPropagation();
                 this.viewportAnimationLoopId = requestAnimationFrame(this.viewportAnimationLoop.bind(this));
             }
        });
        
        // Prevent background clicks in the loop area from triggering tool actions (e.g. creating notes)
        this._view.loopBackground.on("pointerdown", (e: FederatedPointerEvent) => {
            e.stopPropagation();
        });

        // Background click to add note or start selection
        this._view.background.interactive = true;
        this._view.contentContainer.interactive = true;
        this._view.contentContainer.hitArea = new Rectangle(0, 0, 100000, 100000); 

        const handleBackgroundClick = (e: FederatedPointerEvent) => {
            this._app.contextMenuController.hide();
            this.clearRange();
            if (!this._isVisible || !this._track) return;
            const localPos = this._view.contentContainer.toLocal(e.global);

            // Start selection rectangle on right-click drag
            if (e.button === 2) {
                if (!e.shiftKey && !e.ctrlKey) {
                    // Do not clear selection on right-click down, wait for up or other action
                }
                this._isSelecting = true;
                this._selectionStart.copyFrom(localPos);
                this.viewportAnimationLoopId = requestAnimationFrame(this.viewportAnimationLoop.bind(this));
                return; 
            }

            if (e.button !== 0) return; // After this point, only handle left click

            if (App.TOOL_MODE === "SELECT") {
                 // Deselect all on left-click
                this._selectedNotes.clear();
                this.redraw();
                
                // Start Selection Rectangle
                this._isSelecting = true;
                this._selectionStart.copyFrom(localPos);
                this.viewportAnimationLoopId = requestAnimationFrame(this.viewportAnimationLoop.bind(this));
                return;
            }

            if (App.TOOL_MODE === "PEN") {
                // Deselect all
                this._selectedNotes.clear();
                this.redraw();
                
                // Adjust for scrolling and key width
                const yInGrid = localPos.y + this._view.scrollY - this._view.HEADER_HEIGHT;
                let xInGrid = localPos.x - this._view.KEY_WIDTH + this._view.scrollX;
                xInGrid = this.snap(xInGrid);

                const midiNote = 127 - Math.floor(yInGrid / this._view.NOTE_HEIGHT);
                const globalStart = xInGrid * RATIO_MILLS_BY_PX;
                
                if (midiNote >= 0 && midiNote <= 127 && globalStart >= 0) {
                    // Start Creation
                    const ghost = new Graphics();
                    let color = 0xFF0000;
                    if (this._track && this._track.color) {
                        color = parseInt(this._track.color.replace("#", ""), 16);
                    }
                    
                    const x = globalStart / RATIO_MILLS_BY_PX;
                    const y = (127 - midiNote) * this._view.NOTE_HEIGHT;
                    const w = 0; // Start with 0 width, grows with drag
                    const h = this._view.NOTE_HEIGHT;

                    ghost.beginFill(color, 0.5);
                    ghost.lineStyle(1, 0xFFFFFF);
                    ghost.drawRect(0, 0, w, h);
                    ghost.endFill();
                    ghost.position.set(x, y);

                    this._view.notesContainer.addChild(ghost);

                    this._creationState = {
                        start: globalStart,
                        note: midiNote,
                        initialX: e.global.x,
                        ghost: ghost
                    };
                    
                    this.viewportAnimationLoopId = requestAnimationFrame(this.viewportAnimationLoop.bind(this));
                    
                    this.previewNote(midiNote);
                }
            }
        };

        this._view.background.on("pointerdown", handleBackgroundClick);
        this._view.contentContainer.on("pointerdown", handleBackgroundClick);

        this._view.timelineContainer.on("pointerdown", (e: FederatedPointerEvent) => {
            this._app.contextMenuController.hide();
            if (!this._isVisible || !this._track) return;
            if (e.button !== 0) return;

            const localPos = e.getLocalPosition(this._view.timelineContainer);
            let targetX = localPos.x;

            // Apply snapping if enabled and Shift is not held
            if (!(e.originalEvent as unknown as MouseEvent).shiftKey) {
                targetX = this.snap(targetX);
            }

            // Check Resize
            if (this._rangeStart !== null && this._rangeEnd !== null) {
                 const HIT_ZONE = 5;
                 if (Math.abs(targetX - this._rangeStart) < HIT_ZONE) {
                     this._resizeMode = 'LEFT';
                     this._timelinePointerDown = true;
                     e.stopPropagation();
                     return;
                 } else if (Math.abs(targetX - this._rangeEnd) < HIT_ZONE) {
                     this._resizeMode = 'RIGHT';
                     this._timelinePointerDown = true;
                     e.stopPropagation();
                     return;
                 } else if (targetX > this._rangeStart && targetX < this._rangeEnd) {
                     this._isMovingRange = true;
                     this._dragOffset = targetX - this._rangeStart;
                     this._timelinePointerDown = true;
                     e.stopPropagation();
                     return;
                 }
            }

            this.clearRange();
            this._rangeSelectionStart = targetX;
            this._isRangeSelecting = false;
            this._timelinePointerDown = true;
            this._resizeMode = null;
            this._isMovingRange = false;
            
            e.stopPropagation();
        });

        this._view.notesContainer.interactive = true;
        this._view.notesContainer.on("pointerdown", (e: FederatedPointerEvent) => {
            this._app.contextMenuController.hide();
            if (!this._isVisible || !this._track) return;
            if (e.button !== 0 && e.button !== 2) return; // Allow Left and Right click

            e.stopPropagation(); // Stop event from reaching contentContainer/background

            const target = e.target as any;
            if (target.noteData) {
                const localPos = target.toLocal(e.global);
                const width = target.width;

                // Check for resize (Only Left Click)
                let resizeMode: 'LEFT' | 'RIGHT' | null = null;
                if (e.button === 0) {
                    if (localPos.x < this.RESIZE_ZONE) resizeMode = 'LEFT';
                    else if (localPos.x > width - this.RESIZE_ZONE) resizeMode = 'RIGHT';

                    if (resizeMode) {
                        this._isResizing = true;
                        e.stopPropagation();

                        // If resizing a selected note, resize all selected notes
                        // If resizing a non-selected note, only resize that one (and maybe select it?)
                        if (!this._selectedNotes.has(target.noteData.note)) {
                            this._selectedNotes.clear();
                            this._selectedNotes.add(target.noteData.note);
                            this.redraw();
                        }

                        // Collect resizing notes
                        const resizingNotes: any[] = [];
                        for (const child of this._view.notesContainer.children as any[]) {
                            if (child.noteData && this._selectedNotes.has(child.noteData.note)) {
                                resizingNotes.push({
                                    note: child.noteData.note,
                                    region: child.noteData.region,
                                    initialStart: child.noteData.start,
                                    initialDuration: child.noteData.note.duration,
                                    graphic: child
                                });
                            }
                        }

                        this._resizeState = {
                            mode: resizeMode,
                            initialX: e.global.x,
                            initialScrollX: this._view.scrollX,
                            notes: resizingNotes
                        };
                        this.viewportAnimationLoopId = requestAnimationFrame(this.viewportAnimationLoop.bind(this));
                        return;
                    }
                }

                // Selection Logic
                const clickedNote = target.noteData.note;
                const clickedRegion = target.noteData.region;
                const clickedGlobalStart = clickedRegion.start + target.noteData.start;

                let noteToDeselect: MIDINote | null = null;

                if (e.shiftKey && this._lastClickedNote && this._track) {
                    const start1 = this._lastClickedNote.globalStart;
                    const note1 = this._lastClickedNote.note.note;
                    const start2 = clickedGlobalStart;
                    const note2 = clickedNote.note;
                    
                    const minStart = Math.min(start1, start2);
                    const maxStart = Math.max(start1, start2);
                    const minNote = Math.min(note1, note2);
                    const maxNote = Math.max(note1, note2);
                    
                    this._selectedNotes.clear();
                    
                    for (const region of this._track.regions) {
                        if (region instanceof MIDIRegion) {
                            region.midi.forEachNote((note, start) => {
                                const globalStart = region.start + start;
                                if (globalStart >= minStart - 0.1 && globalStart <= maxStart + 0.1 &&
                                    note.note >= minNote && note.note <= maxNote) {
                                    this._selectedNotes.add(note);
                                }
                            });
                        }
                    }
                    this.redraw();
                } else if (e.ctrlKey) {
                    // Toggle selection
                    if (this._selectedNotes.has(clickedNote)) {
                        // Defer deselection to pointerup (in case we drag)
                        noteToDeselect = clickedNote;
                    } else {
                        this._selectedNotes.add(clickedNote);
                        this.redraw();
                    }
                    this._lastClickedNote = { note: clickedNote, globalStart: clickedGlobalStart };
                } else {
                    if (!this._selectedNotes.has(clickedNote)) {
                        this._selectedNotes.clear();
                        this._selectedNotes.add(clickedNote);
                        this.redraw();
                    }
                    this._lastClickedNote = { note: clickedNote, globalStart: clickedGlobalStart };
                }
                
                if (e.button !== 0) return; // Only start drag on Left Click

                // Collect all selected notes and their new graphics after redraw
                const draggedNotes: { note: MIDINote, region: MIDIRegion, initialStart: number, initialNote: number, graphic: any, duration: number }[] = [];
                for (const child of this._view.notesContainer.children as any[]) {
                    if (child.noteData && this._selectedNotes.has(child.noteData.note)) {
                        draggedNotes.push({
                            note: child.noteData.note,
                            region: child.noteData.region,
                            initialStart: child.noteData.start,
                            initialNote: child.noteData.note.note,
                            graphic: child,
                            duration: child.noteData.note.duration
                        });
                    }
                }

                if (draggedNotes.length === 0) return;

                // Determine Origin: The note that was clicked acts as the anchor for snapping
                let originGlobalStart = clickedGlobalStart;
                const isClickedNoteSelected = draggedNotes.some(n => n.note === clickedNote);
                if (!isClickedNoteSelected) {
                    // Fallback: If clicked note was deselected (e.g. Ctrl+Click), pick the first one
                     originGlobalStart = draggedNotes[0].region.start + draggedNotes[0].initialStart;
                }

                // Start drag
                this._isDragging = true;
                this._draggedNote = {
                    initialX: e.global.x,
                    initialY: e.global.y,
                    initialScrollX: this._view.scrollX,
                    originGlobalStart: originGlobalStart,
                    notes: draggedNotes,
                    noteToDeselect: noteToDeselect,
                    clickedInitialNote: clickedNote.note
                };
                
                this.viewportAnimationLoopId = requestAnimationFrame(this.viewportAnimationLoop.bind(this));
                
                this.previewNote(clickedNote.note);

                // Create Ghosts for copy mode
                let color = 0xFF0000;
                if (this._track && this._track.color) {
                    color = parseInt(this._track.color.replace("#", ""), 16);
                }
                const fillColor = lightenColor(color, 0.5); // Selected notes color

                for (const item of draggedNotes) {
                    const rect = new Graphics();
                    const x = (item.region.start + item.initialStart) / RATIO_MILLS_BY_PX;
                    const y = (127 - item.initialNote) * this._view.NOTE_HEIGHT;
                    const w = Math.max(5, item.duration / RATIO_MILLS_BY_PX);
                    const h = this._view.NOTE_HEIGHT;

                    rect.beginFill(fillColor, 0.5); // Ghost is semi-transparent
                    rect.lineStyle(1, 0xFFFFFF);
                    rect.drawRect(0, 0, w, h);
                    rect.endFill();
                    rect.position.set(x, y);
                    
                    rect.visible = false; // Hidden by default
                    this._view.notesContainer.addChild(rect);
                    this._dragGhosts.push(rect);
                }
                
                // Double click check
                if (e.originalEvent.detail === 2) {
                    // Treat as delete selected (single note selected above)
                    this.deleteSelectedNotes();
                    this._isDragging = false;
                    this._draggedNote = null;
                }
            }
        });

        this._view.on("pointermove", (e: FederatedPointerEvent) => {
            if (!this._isVisible || !this._track) return;
            
            this._lastMousePos.copyFrom(e.global);
            this.checkIfScrollingNeeded(e.global.x);

            // Update Cursor Style if hovering over notes
            if (!this._isDragging && !this._isResizing && !this._isSelecting && !this._isDraggingPlayhead && !this._creationState) {
                 const target = e.target as any;
                 if (target && target.noteData) {
                     const localPos = target.toLocal(e.global);
                     const width = target.width;
                     if (localPos.x < this.RESIZE_ZONE) {
                         target.cursor = "w-resize";
                     } else if (localPos.x > width - this.RESIZE_ZONE) {
                         target.cursor = "e-resize";
                     } else {
                         target.cursor = "pointer";
                     }
                 }
            }

            if (this._creationState) {
                const localPos = this._view.notesContainer.toLocal(e.global);
                let targetX = localPos.x;

                if (!(e.originalEvent as unknown as MouseEvent).shiftKey) {
                    targetX = this.snap(targetX);
                }
                
                const targetTime = Math.max(0, targetX * RATIO_MILLS_BY_PX);
                const anchorTime = this._creationState.start;
                
                const startTime = Math.min(anchorTime, targetTime);
                const endTime = Math.max(anchorTime, targetTime);
                
                const duration = Math.max(0, endTime - startTime);
                
                // Update Ghost
                const x = startTime / RATIO_MILLS_BY_PX;
                const w = Math.max(1, duration / RATIO_MILLS_BY_PX); // At least 1px
                const h = this._view.NOTE_HEIGHT;
                
                this._creationState.ghost.clear();
                this._creationState.ghost.position.x = x;
                
                let color = 0xFF0000;
                if (this._track && this._track.color) {
                    color = parseInt(this._track.color.replace("#", ""), 16);
                }

                this._creationState.ghost.beginFill(color, 0.5);
                this._creationState.ghost.lineStyle(1, 0xFFFFFF);
                this._creationState.ghost.drawRect(0, 0, w, h);
                this._creationState.ghost.endFill();
            }

            // Timeline Interaction (Resize, Select, Hover)
            const localPosTimeline = this._view.timelineContainer.toLocal(e.global);
            // Check if within timeline area vertically (approx) or if capturing
            const isOverTimeline = localPosTimeline.y >= 0 && localPosTimeline.y <= this._view.TIMELINE_HEIGHT;

            if (this._timelinePointerDown) {
                let targetX = localPosTimeline.x;
                if (!(e.originalEvent as unknown as MouseEvent).shiftKey) {
                    targetX = this.snap(targetX);
                }

                // Resizing
                if (this._resizeMode) {
                    this._view.timelineContainer.cursor = "ew-resize";
                    let start = this._rangeStart!;
                    let end = this._rangeEnd!;
                    
                    if (this._resizeMode === 'LEFT') {
                        start = targetX;
                        if (start > end) {
                             this._resizeMode = 'RIGHT';
                             start = end;
                             end = targetX;
                        }
                    } else {
                        end = targetX;
                        if (end < start) {
                             this._resizeMode = 'LEFT';
                             end = start;
                             start = targetX;
                        }
                    }
                    this.setRange(start, end);
                    return;
                }

                // Moving Range
                if (this._isMovingRange) {
                    this._view.timelineContainer.cursor = "grabbing";
                    let newStart = targetX - this._dragOffset;
                    
                    if (!(e.originalEvent as unknown as MouseEvent).shiftKey) {
                        newStart = this.snap(newStart);
                    }
                    
                    const duration = this._rangeEnd! - this._rangeStart!;
                    if (newStart < 0) newStart = 0;
                    this.setRange(newStart, newStart + duration);
                    return;
                }

                // Selection Drag
                if (!this._isRangeSelecting && this._rangeSelectionStart !== null) {
                    if (Math.abs(targetX - this._rangeSelectionStart) > 5) {
                        this._isRangeSelecting = true;
                    }
                }

                if (this._isRangeSelecting && this._rangeSelectionStart !== null) {
                     this._view.timelineContainer.cursor = "text";
                     let start = Math.min(this._rangeSelectionStart, targetX);
                     let end = Math.max(this._rangeSelectionStart, targetX);
                     this.setRange(start, end);
                }
                return;
            } 
            else if (isOverTimeline) {
                // Hover logic
                if (this._rangeStart !== null && this._rangeEnd !== null) {
                    const HIT_ZONE = 5;
                    const x = localPosTimeline.x;
                    if (Math.abs(x - this._rangeStart) < HIT_ZONE || Math.abs(x - this._rangeEnd) < HIT_ZONE) {
                        this._view.timelineContainer.cursor = "ew-resize";
                    } else if (x > this._rangeStart + HIT_ZONE && x < this._rangeEnd - HIT_ZONE) {
                        this._view.timelineContainer.cursor = "grab";
                    } else {
                        this._view.timelineContainer.cursor = "default";
                    }
                } else {
                     this._view.timelineContainer.cursor = "default";
                }
            } else {
                // If not over timeline, but was previously interacting, reset cursor.
                // The note hover logic will override this if necessary.
                this._view.timelineContainer.cursor = "default";
            }

            if (this._isSelecting) {
                const currentPos = this._view.contentContainer.toLocal(e.global);
                const x = Math.min(this._selectionStart.x, currentPos.x);
                const y = Math.min(this._selectionStart.y, currentPos.y);
                const w = Math.abs(this._selectionStart.x - currentPos.x);
                const h = Math.abs(this._selectionStart.y - currentPos.y);

                this._view.drawSelectionBox(x, y, w, h);

                // Calculate intersections
                this.updateSelectionFromBox(x, y, w, h);
                
                // Optimized redraw: only update colors of existing graphics
                let color = 0xFF0000; // Default red
                if (this._track && this._track.color) {
                    color = parseInt(this._track.color.replace("#", ""), 16);
                }
                this._view.refreshNoteSelection(this._selectedNotes, color);
                return;
            }

            if (this._isResizing && this._resizeState) {
                const scrollDelta = (this._view.scrollX - this._resizeState.initialScrollX) * RATIO_MILLS_BY_PX;
                const dx = e.global.x - this._resizeState.initialX;
                const rawDt = dx * RATIO_MILLS_BY_PX + scrollDelta;

                for (const item of this._resizeState.notes) {
                    const originalGlobalStart = item.region.start + item.initialStart;
                    const originalGlobalEnd = originalGlobalStart + item.initialDuration;

                    if (this._resizeState.mode === 'RIGHT') {
                        // Resizing Duration
                        // Calculate new end time
                        const newRawEnd = originalGlobalEnd + rawDt;
                        let newSnappedEndX = newRawEnd / RATIO_MILLS_BY_PX;
                        if (!(e.originalEvent as unknown as MouseEvent).shiftKey) {
                            newSnappedEndX = this.snap(newSnappedEndX);
                        }
                        const newSnappedEnd = newSnappedEndX * RATIO_MILLS_BY_PX;
                        
                        let newDuration = Math.max(RATIO_MILLS_BY_PX * 2, newSnappedEnd - originalGlobalStart); // Min width 2px

                        // Update Graphic
                        const newW = newDuration / RATIO_MILLS_BY_PX;
                        item.graphic.width = newW;
                        
                        // Temporarily store the intended duration on the graphic for pointerup to read?
                        // Or just recalculate in pointerup. 
                        // Better to update graphic effectively.
                    } else {
                        // Resizing Start (Left)
                        const newRawStart = originalGlobalStart + rawDt;
                        let newSnappedStartX = newRawStart / RATIO_MILLS_BY_PX;
                        if (!(e.originalEvent as unknown as MouseEvent).shiftKey) {
                            newSnappedStartX = this.snap(newSnappedStartX);
                        }
                        const newSnappedStart = Math.max(0, newSnappedStartX * RATIO_MILLS_BY_PX);
                        
                        // Ensure we don't cross the end
                        // Minimum duration check
                        if (originalGlobalEnd - newSnappedStart < RATIO_MILLS_BY_PX * 2) {
                            // Clamp start
                            // newSnappedStart = originalGlobalEnd - MIN
                            // Ignore for smooth feeling, just clamp duration
                        }

                        let newDuration = Math.max(RATIO_MILLS_BY_PX * 2, originalGlobalEnd - newSnappedStart);
                        const effectiveStart = originalGlobalEnd - newDuration;
                        
                        // Update Graphic
                        const newX = effectiveStart / RATIO_MILLS_BY_PX;
                        const newW = newDuration / RATIO_MILLS_BY_PX;
                        
                        item.graphic.x = newX;
                        item.graphic.width = newW;
                    }
                }
            }

            if (this._isDragging && this._draggedNote) {
                // ... (Existing dragging logic) ...
                // Update Ghosts visibility
                const isCopy = e.ctrlKey || e.metaKey;
                for (const ghost of this._dragGhosts) {
                    ghost.visible = isCopy;
                }

                const dx = e.global.x - this._draggedNote.initialX;
                const dy = e.global.y - this._draggedNote.initialY;

                // Pitch Delta
                const dNote = -Math.round(dy / this._view.NOTE_HEIGHT);
                
                // Preview note logic
                const currentNote = this._draggedNote.clickedInitialNote + dNote;
                const clampedNote = Math.max(0, Math.min(127, currentNote));
                this.previewNote(clampedNote);

                // Time Delta with Relative Snapping
                const scrollDelta = (this._view.scrollX - this._draggedNote.initialScrollX) * RATIO_MILLS_BY_PX;
                const rawDt = dx * RATIO_MILLS_BY_PX + scrollDelta;
                const originCurrent = this._draggedNote.originGlobalStart + rawDt;
                
                // Calculate where the origin note WOULD be snapped
                let originSnappedX = Math.max(0, originCurrent) / RATIO_MILLS_BY_PX;
                if (!(e.originalEvent as unknown as MouseEvent).shiftKey) {
                    originSnappedX = this.snap(originSnappedX);
                }
                
                const originSnappedGlobalStart = originSnappedX * RATIO_MILLS_BY_PX;
                
                // The effective delta applied to ALL notes
                const effectiveDt = originSnappedGlobalStart - this._draggedNote.originGlobalStart;

                for (const item of this._draggedNote.notes) {
                    const globalStart = item.region.start + item.initialStart + effectiveDt;
                    let newGlobalStart = Math.max(0, globalStart);

                    // No individual snapping here
                    let newX = newGlobalStart / RATIO_MILLS_BY_PX;
                    
                    const newNoteVal = Math.max(0, Math.min(127, item.initialNote + dNote));
                    const newY = (127 - newNoteVal) * this._view.NOTE_HEIGHT;
                    
                    item.graphic.position.set(newX, newY);
                }
            }

            // Loop Moving Logic
            if (this._isMovingLoop && this._loopHandleType) {
                 const localPos = this._view.loopContainer.toLocal(e.global);
                 let targetX = localPos.x;
                 const shift = (e.originalEvent as unknown as MouseEvent).shiftKey;

                 // Use hostController.loopRange to get the stored range even if loop is inactive (off)
                 const currentLoop = this._app.hostController.loopRange || [0, 0];
                 let start = currentLoop[0] / RATIO_MILLS_BY_PX;
                 let end = currentLoop[1] / RATIO_MILLS_BY_PX;
                 
                 if (this._loopHandleType === 'LEFT') {
                     if (!shift) targetX = this.snap(targetX);
                     start = targetX;
                     if (start > end) start = end;
                     start = Math.max(0, start);
                 } else if (this._loopHandleType === 'RIGHT') {
                     if (!shift) targetX = this.snap(targetX);
                     end = targetX;
                     if (end < start) end = start;
                 } else if (this._loopHandleType === 'BODY') {
                     const duration = end - start;
                     let newStart = targetX - this._loopDragOffset;
                     
                     if (!shift) {
                         newStart = this.snap(newStart);
                     }
                     
                     start = newStart;
                     if (start < 0) start = 0;
                     end = start + duration;
                 }
                 
                 this._app.hostController.setLoop([start * RATIO_MILLS_BY_PX, end * RATIO_MILLS_BY_PX]);
                 this.redrawLoop();
            }
        });

        const handlePointerUp = (e: FederatedPointerEvent) => {
             this.stopPreview();
             cancelAnimationFrame(this.viewportAnimationLoopId);

             if (this._isMovingLoop) {
                 this._isMovingLoop = false;
                 this._loopHandleType = null;
                 return;
             }

             if (this._timelinePointerDown) {
                 const localPos = this._view.timelineContainer.toLocal(e.global);
                 let targetX = localPos.x;
                 if (!(e.originalEvent as unknown as MouseEvent).shiftKey) {
                    targetX = this.snap(targetX);
                 }

                 if (this._resizeMode) {
                     this.updateNoteSelection();
                     this._resizeMode = null;
                 }
                 else if (this._isMovingRange) {
                     this.updateNoteSelection();
                     this._isMovingRange = false;
                 }
                 else if (this._isRangeSelecting && this._rangeSelectionStart !== null) {
                     this.updateNoteSelection();
                 } else {
                     // Click -> Move Playhead
                     if (this._rangeSelectionStart !== null) {
                         const newPosMs = this._rangeSelectionStart * RATIO_MILLS_BY_PX;
                         this._app.host.playhead = Math.max(0, newPosMs);
                     }
                 }
                 
                 this._timelinePointerDown = false;
                 this._isRangeSelecting = false;
                 this._view.timelineContainer.cursor = "default";
                 return;
             }

             if (this._creationState) {
                const localPos = this._view.notesContainer.toLocal(e.global);
                let targetX = localPos.x;

                if (!(e.originalEvent as unknown as MouseEvent).shiftKey) {
                    targetX = this.snap(targetX);
                }
                
                const targetTime = Math.max(0, targetX * RATIO_MILLS_BY_PX);
                const anchorTime = this._creationState.start;
                
                let startTime = Math.min(anchorTime, targetTime);
                let endTime = Math.max(anchorTime, targetTime);
                let duration = endTime - startTime;

                // If user just clicked (duration is 0 or very small), use a small default
                // User requested "quite short", so let's say 125ms (1/16th @ 120bpm approx) or just 100ms
                if (duration < RATIO_MILLS_BY_PX * 2) {
                    startTime = anchorTime;
                    duration = 100; // Default short duration
                }

                this.addNote(this._creationState.note, startTime, duration);
                
                this._creationState.ghost.destroy();
                this._creationState = null;
                return;
             }

             if (this._isSelecting) {
                 this._isSelecting = false;
                 this._view.clearSelectionBox();
                 return;
             }

             if (this._isResizing && this._resizeState) {
                const scrollDelta = (this._view.scrollX - this._resizeState.initialScrollX) * RATIO_MILLS_BY_PX;
                const dx = e.global.x - this._resizeState.initialX;
                const rawDt = dx * RATIO_MILLS_BY_PX + scrollDelta;

                this.executeWithUndo(() => {
                    const newSelection = new Set<MIDINote>();
                    
                    for (const item of this._resizeState!.notes) {
                         const originalGlobalStart = item.region.start + item.initialStart;
                         const originalGlobalEnd = originalGlobalStart + item.initialDuration;
                         
                         let newStart = originalGlobalStart;
                         let newDuration = item.initialDuration;

                         if (this._resizeState!.mode === 'RIGHT') {
                             const newRawEnd = originalGlobalEnd + rawDt;
                             let newSnappedEndX = newRawEnd / RATIO_MILLS_BY_PX;
                             if (!(e.originalEvent as unknown as MouseEvent).shiftKey) {
                                 newSnappedEndX = this.snap(newSnappedEndX);
                             }
                             const newSnappedEnd = newSnappedEndX * RATIO_MILLS_BY_PX;
                             newDuration = Math.max(RATIO_MILLS_BY_PX * 2, newSnappedEnd - originalGlobalStart);
                         } else {
                             const newRawStart = originalGlobalStart + rawDt;
                             let newSnappedStartX = newRawStart / RATIO_MILLS_BY_PX;
                             if (!(e.originalEvent as unknown as MouseEvent).shiftKey) {
                                 newSnappedStartX = this.snap(newSnappedStartX);
                             }
                             newStart = Math.max(0, newSnappedStartX * RATIO_MILLS_BY_PX);
                             newDuration = Math.max(RATIO_MILLS_BY_PX * 2, originalGlobalEnd - newStart);
                             newStart = originalGlobalEnd - newDuration;
                         }

                         // Apply change
                         this._deleteNoteInternal(item.region, item.note, item.initialStart);
                         const added = this._addNoteInternal(item.note.note, newStart, newDuration);
                         if (added) newSelection.add(added);
                    }
                    this._selectedNotes = newSelection;
                    this.redraw();
                });

                this._isResizing = false;
                this._resizeState = null;
                return;
             }

             if (this._isDragging && this._draggedNote && this._track) {
                // Clear Ghosts
                for (const ghost of this._dragGhosts) {
                    ghost.destroy();
                }
                this._dragGhosts = [];

                const dx = e.global.x - this._draggedNote.initialX;
                const dy = e.global.y - this._draggedNote.initialY;
                const isCopy = e.ctrlKey || e.metaKey;
                const scrollDelta = (this._view.scrollX - this._draggedNote.initialScrollX) * RATIO_MILLS_BY_PX;
                
                if (Math.abs(dx) > 5 || Math.abs(dy) > 5 || Math.abs(scrollDelta) > 5) {
                    // Calculate effective delta (same as pointermove)
                    const rawDt = dx * RATIO_MILLS_BY_PX + scrollDelta;
                    const originCurrent = this._draggedNote.originGlobalStart + rawDt;
                    let originSnappedX = Math.max(0, originCurrent) / RATIO_MILLS_BY_PX;
                    if (!(e.originalEvent as unknown as MouseEvent).shiftKey) {
                        originSnappedX = this.snap(originSnappedX);
                    }
                    const originSnappedGlobalStart = originSnappedX * RATIO_MILLS_BY_PX;
                    const effectiveDt = originSnappedGlobalStart - this._draggedNote.originGlobalStart;

                    const dNote = -Math.round(dy / this._view.NOTE_HEIGHT);

                    this.executeWithUndo(() => {
                        const newSelection = new Set<MIDINote>();
                        for (const item of this._draggedNote!.notes) {
                            const oldLocalStart = item.initialStart;
                            
                            // Apply effectiveDt
                            let globalStart = item.region.start + item.initialStart + effectiveDt;
                            let newGlobalStart = Math.max(0, globalStart);
                            
                            const newNoteVal = Math.max(0, Math.min(127, item.initialNote + dNote));

                            if (!isCopy) {
                                this._deleteNoteInternal(item.region, item.note, oldLocalStart);
                            }
                            const addedNote = this._addNoteInternal(newNoteVal, newGlobalStart, item.duration);
                            if (addedNote) newSelection.add(addedNote);
                        }
                        this._selectedNotes = newSelection;
                        this.redraw();
                    });
                } else {
                    // If moved very little, just redraw to reset positions (in case snap moved them slightly)
                    // Also handle deferred deselection
                    if (this._draggedNote.noteToDeselect) {
                        this._selectedNotes.delete(this._draggedNote.noteToDeselect);
                    }
                    this.redraw();
                }
             }
             this._isDragging = false;
             this._draggedNote = null;
        };

        this._view.on("pointerup", handlePointerUp);
        this._view.on("pointerupoutside", handlePointerUp);
    }

    private updateSelectionFromBox(x: number, y: number, w: number, h: number) {
        // Convert box to Grid coordinates
        // Box is in contentContainer space (localPos)
        // Note rects are in contentContainer space too? 
        // drawNotes does: rect.position.set(x, y); this.notesContainer.addChild(rect);
        // notesContainer is shifted by scroll.
        // contentContainer is parent of notesContainer.
        // wait, drawNotes clears notesContainer and sets its X/Y.
        // So notes are inside notesContainer.
        // selectionBox is inside contentContainer.
        // We need to map selectionBox coordinates (contentContainer space) to notesContainer space, OR compare global coords.
        // Or simpler: Map selectionBox to grid time/pitch.
        
        // Rect in Grid/Note space:
        // x_grid = x - notesContainer.x
        // y_grid = y - notesContainer.y
        const ncX = this._view.notesContainer.x;
        const ncY = this._view.notesContainer.y;
        
        const rectX = x - ncX;
        const rectY = y - ncY;
        // rectW, rectH same
        
        this._selectedNotes.clear();
        
        for (const region of this._track!.regions) {
            if (region instanceof MIDIRegion) {
                region.midi.forEachNote((note, start) => {
                    const globalStart = region.start + start;
                    const noteX = globalStart / RATIO_MILLS_BY_PX;
                    const noteY = (127 - note.note) * this._view.NOTE_HEIGHT;
                    const noteW = Math.max(5, note.duration / RATIO_MILLS_BY_PX);
                    const noteH = this._view.NOTE_HEIGHT;
                    
                    // AABB Check
                    if (rectX < noteX + noteW &&
                        rectX + w > noteX &&
                        rectY < noteY + noteH &&
                        rectY + h > noteY) {
                        this._selectedNotes.add(note);
                    }
                });
            }
        }
    }

    private snapshotRegions(): any[] {
        if (!this._track) return [];
        // Clone all regions in the track
        return this._track.regions.map(r => r.clone());
    }

    private restoreTrackState(track: Track, regions: any[]) {
        const waveform = this._app.editorView.getWaveFormViewById(track.id);
        if (waveform) {
            [...waveform.regionViews].forEach(rv => waveform.removeRegionView(rv));
        }
        track.regions = [];
        regions.forEach(r => {
            const clone = r.clone(); 
            this._app.regionsController.addRegion(track, clone as RegionOf<any>, waveform);
        });
        track.update(audioCtx);
        track.modified = true;
    }

    private getSelectedNoteSignatures(): Set<string> {
        const signatures = new Set<string>();
        if (!this._track) return signatures;
        for (const region of this._track.regions) {
            if (region instanceof MIDIRegion) {
                region.midi.forEachNote((note, start) => {
                    if (this._selectedNotes.has(note)) {
                        // Signature: global start time | pitch | duration
                        const signature = `${(region.start + start).toFixed(2)}|${note.note}|${note.duration.toFixed(2)}`;
                        signatures.add(signature);
                    }
                });
            }
        }
        return signatures;
    }

    private restoreSelectionFromSignatures(signatures: Set<string>, track: Track) {
        this._selectedNotes.clear();
        if (!track) return;
        for (const region of track.regions) {
            if (region instanceof MIDIRegion) {
                region.midi.forEachNote((note, start) => {
                    const signature = `${(region.start + start).toFixed(2)}|${note.note}|${note.duration.toFixed(2)}`;
                    if (signatures.has(signature)) {
                        this._selectedNotes.add(note);
                    }
                });
            }
        }
    }

    private executeWithUndo(action: () => void) {
        if (!this._track) return;

        const trackId = this._track.id;
        const beforeRegions = this.snapshotRegions();
        const beforeSignatures = this.getSelectedNoteSignatures();
        
        action();
        
        const afterRegions = this.snapshotRegions();
        const afterSignatures = this.getSelectedNoteSignatures();
        
        const redo = () => {
            const track = this._app.tracksController.getTrackById(trackId);
            if (!track) return;
            this.restoreTrackState(track, afterRegions);
            if (this._track?.id === trackId) {
                this.restoreSelectionFromSignatures(afterSignatures, track);
                this.redraw();
            }
        };
        const undo = () => {
            const track = this._app.tracksController.getTrackById(trackId);
            if (!track) return;
            this.restoreTrackState(track, beforeRegions);
            if (this._track?.id === trackId) {
                this.restoreSelectionFromSignatures(beforeSignatures, track);
                this.redraw();
            }
        };
        
        this._app.doIt(true, redo, undo);
    }

    private addNote(noteVal: number, globalStart: number, duration: number = 500) {
        this.executeWithUndo(() => {
            this._addNoteInternal(noteVal, globalStart, duration);
        });
    }

    private moveNoteWithUndo(oldRegion: MIDIRegion, oldNote: MIDINote, oldLocalStart: number, newNoteVal: number, newGlobalStart: number, duration: number) {
        this.executeWithUndo(() => {
            this._deleteNoteInternal(oldRegion, oldNote, oldLocalStart);
            const addedNote = this._addNoteInternal(newNoteVal, newGlobalStart, duration);
            if (addedNote) {
                this._selectedNotes.clear();
                this._selectedNotes.add(addedNote);
            }
        });
    }

    public deleteSelectedNotes() {
        if (!this._track || this._selectedNotes.size === 0) return;
        
        this.executeWithUndo(() => {
            for (const region of this._track!.regions) {
                if (region instanceof MIDIRegion) {
                    const notesToDelete: {note: MIDINote, start: number}[] = [];
                    region.midi.forEachNote((note, start) => {
                        if (this._selectedNotes.has(note)) {
                            notesToDelete.push({note, start});
                        }
                    });
                    
                    notesToDelete.forEach(item => {
                        this._deleteNoteInternal(region, item.note, item.start);
                    });
                }
            }
            this._selectedNotes.clear();
        });
    }

    public selectAllNotes() {
        if (!this._track) return;
        this._selectedNotes.clear();
        
        for (const region of this._track.regions) {
            if (region instanceof MIDIRegion) {
                region.midi.forEachNote((note, start) => {
                    this._selectedNotes.add(note);
                });
            }
        }
        
        this.redraw();
    }

    public pasteNotes() {
        if (this._clipboard.length === 0 || !this._track) return;
        
        this.executeWithUndo(() => {
            const currentPlayhead = this._app.host.playhead;
            this._selectedNotes.clear();
            this._clipboard.forEach(item => {
                const newStart = currentPlayhead + item.startOffset;
                const newNote = this._addNoteInternal(item.note.note, newStart, item.note.duration);
                if (newNote) this._selectedNotes.add(newNote);
            });
        });
    }

    public copySelectedNotes() {
        this._clipboard = [];
        let minStart = Infinity;
        
        for (const region of this._track!.regions) {
            if (region instanceof MIDIRegion) {
                region.midi.forEachNote((note, start) => {
                    if (this._selectedNotes.has(note)) {
                        const globalStart = region.start + start;
                        if (globalStart < minStart) minStart = globalStart;
                    }
                });
            }
        }

        if (minStart === Infinity) return;

        for (const region of this._track!.regions) {
            if (region instanceof MIDIRegion) {
                region.midi.forEachNote((note, start) => {
                    if (this._selectedNotes.has(note)) {
                        const globalStart = region.start + start;
                        this._clipboard.push({
                            note: note, // Reference copy is fine as we don't mutate MIDINote props usually
                            startOffset: globalStart - minStart
                        });
                    }
                });
            }
        }
    }

    public cutSelectedNotes() {
        this.copySelectedNotes();
        this.deleteSelectedNotes();
    }

    // Internal methods that modify state without Undo (Undo handled by wrapper)
    private _addNoteInternal(noteVal: number, globalStart: number, duration: number): MIDINote | null {
        if (!this._track) return null;
        
        let targetRegion: MIDIRegion | null = null;
        for (const region of this._track.regions) {
            if (region instanceof MIDIRegion && globalStart >= region.start && globalStart < region.end) {
                targetRegion = region;
                break;
            }
        }

        if (!targetRegion) {
            let minDistance = Infinity;
            let closestRegion: MIDIRegion | null = null;
            for (const region of this._track.regions) {
                if (region instanceof MIDIRegion) {
                    const distStart = Math.abs(globalStart - region.start);
                    const distEnd = Math.abs(globalStart - region.end);
                    const dist = Math.min(distStart, distEnd);
                    if (dist < minDistance) {
                        minDistance = dist;
                        closestRegion = region;
                    }
                }
            }

            if (closestRegion) {
                targetRegion = closestRegion;
                if (globalStart < targetRegion.start) {
                    const shift = targetRegion.start - globalStart;
                    targetRegion.midi.duration += shift;
                    targetRegion.start = globalStart;
                    targetRegion.midi.instants.forEach(instant => {
                        instant.forEach(n => { n.offset += shift; });
                    });
                } else if (globalStart >= targetRegion.end) {
                    const newEnd = globalStart + duration;
                    targetRegion.midi.duration = newEnd - targetRegion.start;
                }
            }
        }
        
        const localStart = targetRegion ? globalStart - targetRegion.start : 0;
        let createdNote: MIDINote | null = null;

        if (targetRegion && localStart >= 0) {
            createdNote = new MIDINote(noteVal, 100, 0, duration);
            if (localStart + duration > targetRegion.duration) {
                targetRegion.midi.duration = localStart + duration;
            }
            targetRegion.midi.putNote(createdNote, localStart);
            this.checkAndMergeOverlaps(targetRegion);
        }
        
        if (createdNote) {
            // Select logic handled by caller usually, but internal ensures creation
        }

        this.updateTrack();
        // Update views
        this._track.regions.forEach(r => this._app.regionsController.updateRegionView(r as RegionOf<any>));
        this.redraw();
        return createdNote;
    }

    private _deleteNoteInternal(region: MIDIRegion, note: MIDINote, start: number) {
        const instantIndex = Math.floor(start / region.midi.instant_duration);
        const instant = region.midi.instantAt(instantIndex);
        if (instant) {
             const index = instant.findIndex(n => n.note === note && Math.abs(n.offset + instantIndex * region.midi.instant_duration - start) < 1);
             if (index !== -1) {
                 instant.splice(index, 1);
             }
        }
        this.updateTrack();
        this._track?.regions.forEach(r => this._app.regionsController.updateRegionView(r as RegionOf<any>));
        this.redraw();
    }

    private checkAndMergeOverlaps(mainRegion: MIDIRegion) {
        const overlaps = this._track!.regions.filter(r => 
            r !== mainRegion && r instanceof MIDIRegion &&
            (
                (r.start >= mainRegion.start && r.start < mainRegion.end) || 
                (r.end > mainRegion.start && r.end <= mainRegion.end) ||   
                (r.start <= mainRegion.start && r.end >= mainRegion.end)   
            )
        ) as MIDIRegion[];
        
        if (overlaps.length > 0) {
            overlaps.forEach(other => {
                this._app.regionsController.mergeRegionWith(mainRegion, other as MIDIRegion);
                this._app.regionsController.removeRegion(other);
            });
        }
    }

    private previewNote(noteVal: number) {
        if (!this._track) return;
        
        const currentTime = audioCtx.currentTime;
        
        // Stop previous note if exists and different
        if (this._lastPreviewedNote !== null && this._lastPreviewedNote !== noteVal) {
             this._track.audioInputNode.scheduleEvents({
                 type: 'wam-midi',
                 time: currentTime,
                 data: { bytes: [0x80, this._lastPreviewedNote, 100] }
             });
        }
        
        // Play new note if different
        if (this._lastPreviewedNote !== noteVal) {
             this._track.audioInputNode.scheduleEvents({
                 type: 'wam-midi',
                 time: currentTime,
                 data: { bytes: [0x90, noteVal, 100] }
             });
             this._lastPreviewedNote = noteVal;
        }
    }
    
    private stopPreview() {
        if (!this._track || this._lastPreviewedNote === null) return;
        const currentTime = audioCtx.currentTime;
        this._track.audioInputNode.scheduleEvents({
             type: 'wam-midi',
             time: currentTime,
             data: { bytes: [0x80, this._lastPreviewedNote, 100] }
        });
        this._lastPreviewedNote = null;
    }

    public updateRangeAfterZoom(oldRatio: number, newRatio: number) {
        if (this._rangeStart !== null && this._rangeEnd !== null) {
            const startMs = this._rangeStart * oldRatio;
            const endMs = this._rangeEnd * oldRatio;
            
            this._rangeStart = startMs / newRatio;
            this._rangeEnd = endMs / newRatio;
            
            this._view.drawRangeSelection(this._rangeStart, this._rangeEnd - this._rangeStart);
        }
        this.redrawLoop();
    }

    public updateLoop(active: boolean) {
        this.redrawLoop();
    }

    public updateLoopRange(range: [number, number]) {
        this.redrawLoop();
    }
    
    public redrawLoop() {
        const active = !!this._app.host.loopRange;
        const range = this._app.hostController.loopRange; // Always returns [start, end] even if inactive
        
        if (range) {
             const startPx = range[0] / RATIO_MILLS_BY_PX;
             const endPx = range[1] / RATIO_MILLS_BY_PX;
             this._view.drawLoop(startPx, endPx, active);
             this._view.loopContainer.visible = true;
        } else {
             // Default if undefined? HostController always initializes it.
             this._view.loopContainer.visible = false;
        }
    }
}