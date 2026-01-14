import { FederatedPointerEvent } from "pixi.js";
import App from "../../App";
import { RATIO_MILLS_BY_PX, TEMPO } from "../../Env";
import { keepAlive } from "../../Utils/gui_callback";
import { isKeyPressed, registerOnKeyDown, registerOnKeyUp } from "../../Utils/keys";
import EditorView from "../../Views/Editor/EditorView";
import PlayheadView from "../../Views/Editor/PlayheadView";

/**
 * The class that control the events related to the playhead.
 */
export default class PlayheadController {


  /**
   * Route Application.
   */
  private _app: App;
  /**
   * View of the playhead.
   */
  private _view: PlayheadView;
  /**
   * Boolean that is set true when the user is currently moving the playhead.
   */
  private _movingPlayhead: boolean;

  /**
   * Check if the pointer is down in the playhead track.
   */
  private _pointerIsDown: boolean = false;

  /* for disabling snapping is shift key is pressed and global snapping enabled */
  private snappingDisabled: boolean = false;

  private _arrowKeyTimer: any = null;
  private _arrowKeyInterval: any = null;

  // Range Selection State
  private _selectionStart: number | null = null;
  private _isSelectingRange: boolean = false;
  private _rangeStart: number | null = null;
  private _rangeEnd: number | null = null;
  private _resizeMode: 'LEFT' | 'RIGHT' | null = null;
  private _isMovingRange: boolean = false;
  private _dragOffset: number = 0;

  constructor(app: App) {
    this._app = app;
    this._view = app.editorView.playhead;
    this._movingPlayhead = false;

    this.bindEvents();
    this._app.host.onPlayHeadMove.add((pos, movedByPlayer) => {
      this._app.editorView.playhead.moveTo(pos / RATIO_MILLS_BY_PX)
      this.moveAccordingToPlayhead(pos, movedByPlayer)
      this._app.hostView.updateTimer(pos);
    })
  }

  /**
   * Get the current playhead position in milliseconds.
   */
  get playheadTime(): number {
    return this._app.host.playhead;
  }

  /**
   * Get the current playhead position in pixels.
   */
  get playheadX(): number {
    return this._app.host.playhead / RATIO_MILLS_BY_PX;
  }

  /**
   * Bind on initialisation the events related to the playhead : pointerdown, pointerup, pointermove and so on...
   * @private
   */
  private bindEvents() {
    registerOnKeyUp((key) => {
      if (key === "Shift") this.snappingDisabled = false
      if (key === "ArrowLeft" || key === "ArrowRight") this.stopArrowRepeat();
    })

    registerOnKeyDown((key) => {
      if (key === "Shift") this.snappingDisabled = true;

      const regionsSelected = this._app.regionsController.hasSelection();
      const notesSelected = this._app.pianoRollController.hasSelection() && this._app.pianoRollController.isVisible;

      if (!regionsSelected && !notesSelected) {
        if (key === "ArrowLeft" && !isKeyPressed("Control", "Meta")) this.handleArrowPress(-1);
        if (key === "ArrowRight" && !isKeyPressed("Control", "Meta")) this.handleArrowPress(1);
      }
    })

    this._view.track.on("pointerup", (e) => {
      this.handlePointerUp(e);
    });
    this._view.track.on("pointerupoutside", (e) => {
      this.handlePointerUp(e);
    });
    this._view.track.on("pointerdown", (e) => {
      this.handlePointerDown(e);
    });
    this._app.editorView.grid.on("pointerdown", (e) => {
      // to handle cliks on bar numbers, step lines etc.
      // that prevented the playhead to move
      // call handlePointerDown only if the click occured on the top line of the grid
      // otherwise, let the click be handled by the grid clicking on a line in the middle of screen
      // would move the playhead...
      //console.log("e.data.global.y = " + e.data.global.y + "PLAYHEAD_HEIGHT = " + EditorView.PLAYHEAD_HEIGHT);
      if (e.data.global.y < EditorView.PLAYHEAD_HEIGHT + 10) {
        this.handlePointerDown(e);
        e.stopPropagation();
      }
    });
    this._app.editorView.grid.on("pointerup", (e) => {
      // to handle cliks on bar numbers, step lines etc.
      // that prevented the playhead to move
      // call handlePointerUp only if the click occured on the top line of the grid
      if (e.data.global.y < EditorView.PLAYHEAD_HEIGHT + 10)
        this.handlePointerUp(e);
    });
    this._app.editorView.grid.on("globalpointermove", (e) => {
      // to handle cliks on bar numbers, step lines etc.
      // that prevented the playhead to move
      // call handlePointerUp only if the click occured on the top line of the grid
      if (e.data.global.y < EditorView.PLAYHEAD_HEIGHT + 10)
        this.handlePointerMove(e);
    });

    this._view.handle.on("pointerup", (e) => {
      this.handlePointerUp(e);
    });
    this._view.handle.on("pointerupoutside", (e) => {
      this.handlePointerUp(e);
    });
    this._view.handle.on("pointerdown", (e) => {
      this.handlePointerDown(e);
    });
    this._view.handle.on("pointerout", () => {
      document.body.style.cursor = "default";
    });
    this._view.handle.on("pointerover", () => {
      document.body.style.cursor = "grab";
    });

    this._view.track.on("globalpointermove", (e) => {
      this.handlePointerMove(e);
    });
  }

  /** 
   * Get a snapped position of the playhead from a free position of the playhead.
   * @param pos - The free position of the playhead in pixels.
   * */
  getSnappedPosition(pos: number) {
    if (this._app.editorView.snapping && !this.snappingDisabled) {
      const cellSize = this._app.editorView.cellSize
      return Math.round(pos / cellSize) * cellSize
    }
    return pos
  }
  /**
   * Move the playhead to a specific position in milliseconds.
   * @param pos - The new position of the playhead in milliseconds.
   * @param doSnap - If true, the playhead will snap according to the grid settings.
   */
  moveTo(pos: number, doSnap: boolean = false) {
    let pixelPos = pos / RATIO_MILLS_BY_PX

    if (this._app.editorView.snapping && doSnap && !this.snappingDisabled) {
      pixelPos = this.getSnappedPosition(pixelPos)
    }
    if (pixelPos < 0) pixelPos = 0

    this._app.tracksController.jumpTo(pixelPos)
    this._view.moveTo(pixelPos)
    this._app.hostView.metronome.playhead = pos
  }

  private handlePointerMove(e: FederatedPointerEvent) {
    if (this._app.pianoRollController.isVisible) return;

    let pos = e.data.global.x + this._app.editorView.viewport.left;

    // 1. Resizing
    if (this._resizeMode) {
      document.body.style.cursor = "ew-resize";
      if (this._app.editorView.snapping && !this.snappingDisabled) {
        const cellSize = this._app.editorView.cellSize;
        pos = Math.round(pos / cellSize) * cellSize;
      }

      let start = this._rangeStart!;
      let end = this._rangeEnd!;

      if (this._resizeMode === 'LEFT') {
        start = pos;
        if (start > end) { // Swap
          this._resizeMode = 'RIGHT';
          start = end;
          end = pos;
        }
      } else {
        end = pos;
        if (end < start) {
          this._resizeMode = 'LEFT';
          end = start;
          start = pos;
        }
      }
      this.setRange(start, end);
      return;
    }

    // 1.5 Moving Range
    if (this._isMovingRange) {
      document.body.style.cursor = "grabbing";
      let newStart = pos - this._dragOffset;

      if (this._app.editorView.snapping && !this.snappingDisabled) {
        const cellSize = this._app.editorView.cellSize;
        newStart = Math.round(newStart / cellSize) * cellSize;
      }

      const duration = this._rangeEnd! - this._rangeStart!;
      if (newStart < 0) newStart = 0;
      this.setRange(newStart, newStart + duration);
      return;
    }

    // 2. Moving Playhead (Handle)
    if (this._movingPlayhead) {
      document.body.style.cursor = "grabbing";
      this.moveTo(pos * RATIO_MILLS_BY_PX, true)
      this.moveAccordingToPlayhead(pos * RATIO_MILLS_BY_PX, false)
      return;
    }

    // 3. New Selection Drag
    if (this._pointerIsDown) {
      if (!this._isSelectingRange && this._selectionStart !== null) {
        const diff = Math.abs(pos - this._selectionStart);
        if (diff > 5) {
          this._isSelectingRange = true;
        }
      }

      if (this._isSelectingRange && this._selectionStart !== null) {
        document.body.style.cursor = "text";
        let start = Math.min(this._selectionStart, pos);
        let end = Math.max(this._selectionStart, pos);

        if (this._app.editorView.snapping && !this.snappingDisabled) {
          const cellSize = this._app.editorView.cellSize;
          start = Math.round(start / cellSize) * cellSize;
          end = Math.round(end / cellSize) * cellSize;
        }
        this.setRange(start, end);
      }
    }
    // 4. Hover State (Cursor)
    else {
      const yPos = e.data.global.y;
      const isOverTimeline = yPos >= EditorView.LOOP_HEIGHT && yPos < (EditorView.LOOP_HEIGHT + EditorView.PLAYHEAD_HEIGHT + 10);

      if (isOverTimeline && this._rangeStart !== null && this._rangeEnd !== null) {
        const HIT_ZONE = 5;
        if (Math.abs(pos - this._rangeStart) < HIT_ZONE || Math.abs(pos - this._rangeEnd) < HIT_ZONE) {
          document.body.style.cursor = "ew-resize";
        } else if (pos > this._rangeStart + HIT_ZONE && pos < this._rangeEnd - HIT_ZONE) {
          document.body.style.cursor = "grab";
        } else {
          document.body.style.cursor = "default";
        }
      } else {
        document.body.style.cursor = "default";
      }
    }
  }

  public setRange(start: number, end: number, fromSync: boolean = false) {
    this._rangeStart = start;
    this._rangeEnd = end;
    this._app.editorView.drawRangeSelection(start, end - start);

    if (!fromSync && this._app.pianoRollController) {
      this._app.pianoRollController.setRange(start, end, true);
    }
  }

  public clearRange(fromSync: boolean = false) {
    this._rangeStart = null;
    this._rangeEnd = null;
    this._app.editorView.clearRangeSelection();

    if (!fromSync && this._app.pianoRollController) {
      this._app.pianoRollController.clearRange(true);
    }
  }

  /**
   * Handler for the pointer down event. It declares the start of the move.
   *
   * @param e - Event fired by PIXI.JS that contains all the information needed to handle the event
   */
  private handlePointerDown(e: FederatedPointerEvent) {
    if (this._app.pianoRollController.isVisible) return;

    this._pointerIsDown = true;
    let pos = e.data.global.x + this._app.editorView.viewport.left; this._app.hostController.pauseTimerInterval();

    if (e.currentTarget === this._view.handle) {
      // Handle Drag - Move immediately
      this._movingPlayhead = true;
      this.moveTo(pos * RATIO_MILLS_BY_PX, true);
      return;
    }

    // Check Resize
    if (this._rangeStart !== null && this._rangeEnd !== null) {
      const HIT_ZONE = 5;
      if (Math.abs(pos - this._rangeStart) < HIT_ZONE) {
        this._resizeMode = 'LEFT';
        e.stopPropagation();
        return;
      } else if (Math.abs(pos - this._rangeEnd) < HIT_ZONE) {
        this._resizeMode = 'RIGHT';
        e.stopPropagation();
        return;
      }
    }

    // Check Move Body
    if (this._rangeStart !== null && this._rangeEnd !== null) {
      if (pos > this._rangeStart && pos < this._rangeEnd) {
        this._isMovingRange = true;
        this._dragOffset = pos - this._rangeStart;
        e.stopPropagation();
        return;
      }
    }

    this.clearRange();
    this._selectionStart = pos;
    this._isSelectingRange = false;
    this._movingPlayhead = false;
    this._resizeMode = null;
    this._isMovingRange = false;
  }
  /**
   * Handler for the pointer up event. It declares when the user has stopped moving the playhead.
   * It will then jump to the current value of the playhead.
   *
   * @param e - Event fired by PIXI.JS that contains all the information needed to handle the event
   */
  private updateRegionsSelection() {
    if (this._rangeStart === null || this._rangeEnd === null) return;

    const startMs = this._rangeStart * RATIO_MILLS_BY_PX;
    const endMs = this._rangeEnd * RATIO_MILLS_BY_PX;

    this._app.regionsController.selection.set(null);
    for (const track of this._app.tracksController.tracks) {
      for (const region of track.regions) {
        if (region.start < endMs && region.end > startMs) {
          this._app.regionsController.selection.add(region as any);
        }
      }
    }
  }

  public getRangePx(): { start: number, end: number } | null {
    if (this._rangeStart !== null && this._rangeEnd !== null) {
      return { start: this._rangeStart, end: this._rangeEnd };
    }
    return null;
  }

  private handlePointerUp(e: FederatedPointerEvent) {
    if (this._pointerIsDown) {
      let pos = e.data.global.x + this._app.editorView.viewport.left;
      if (pos < 0) {
        pos = 0;
      }

      document.body.style.cursor = "grab";

      if (this._movingPlayhead) {
        // Finished scrubbing
        this.moveTo(pos * RATIO_MILLS_BY_PX, true);
        this._movingPlayhead = false;
      }
      else if (this._resizeMode) {
        this.updateRegionsSelection();
        this._resizeMode = null;
      }
      else if (this._isMovingRange) {
        this.updateRegionsSelection();
        this._isMovingRange = false;
      }
      else {
        // Finished Track Click/Drag
        if (this._isSelectingRange && this._selectionStart !== null) {
          this.updateRegionsSelection();
        } else {
          // Simple Click - Jump Playhead
          // Use selectionStart (initial click pos) for consistency
          if (this._selectionStart !== null) {
            this.moveTo(this._selectionStart * RATIO_MILLS_BY_PX, true);
          }
        }
      }

      this._isSelectingRange = false;
      this._app.hostController.resumeTimerInterval();
      if (this._app.host.isPlaying) {
        this._app.automationController.applyAllAutomations();
      }
      this._pointerIsDown = false;
    }


    // MB : for debugging viewport centering
    //this._app.editorView.viewport.moveCenter(this._view.x, this._app.editorView.viewport.center.y);
    //console.log("this._app.editorView.viewport.center.x =" + this._app.editorView.viewport.center.x)
  }



  private handleArrowPress(direction: number) {
    this.stopArrowRepeat(); // Safety clear
    this.movePlayheadOneBeat(direction); // Instant move

    this._arrowKeyTimer = setTimeout(() => {
      this._arrowKeyInterval = setInterval(() => {
        this.movePlayheadOneBeat(direction);
      }, 50); // Speed: 50ms
    }, 500); // Delay: 500ms
  }

  private stopArrowRepeat() {
    if (this._arrowKeyTimer) clearTimeout(this._arrowKeyTimer);
    if (this._arrowKeyInterval) clearInterval(this._arrowKeyInterval);
    this._arrowKeyTimer = null;
    this._arrowKeyInterval = null;
  }

  /**
   * Moves the playhead by one beat in the specified direction.
   * @param direction - 1 for forward, -1 for backward.
   */
  private movePlayheadOneBeat(direction: number) {
    const beatDuration = (60 / TEMPO) * 1000;
    const newPos = this._app.host.playhead + (direction * beatDuration);
    this.moveTo(Math.max(0, newPos), true);
  }

  /**
   * Move the view according to a a new playhead position.
   * @param newPlayhead The new playhead position in milliseconds.
   */
  public moveAccordingToPlayhead(newPlayhead: number, movedByPlayer: boolean) {
    // Get playhead position informations
    const playheadX = newPlayhead / RATIO_MILLS_BY_PX
    const previousPlayheadX = (newPlayhead - 500) / RATIO_MILLS_BY_PX

    // Get viewport informations
    const viewport = this._app.editorView.viewport
    const viewportWidth = viewport.right - viewport.left
    const viewportCenter = (viewport.right + viewport.left) / 2

    // When playing
    if (movedByPlayer) {
      // If it has just overpassed the center of the viewport, move the viewport
      if (previousPlayheadX <= viewportCenter && playheadX >= viewportCenter) {
        this._view.viewportLeft = Math.max(0, playheadX - viewportWidth / 2)
      }

      // If it has just overpassed the right of the viewport, move the viewport
      if (playheadX > viewport.right) {
        this._view.viewportLeft = Math.max(0, playheadX - viewportWidth / 2)
      }
    }
    // When hand moved
    else {
      // If it has just overpassed the right of the viewport, move the viewport
      const PADDING = 50; // px
      if (playheadX > viewport.right) {
        this._view.viewportLeft = playheadX - viewportWidth + PADDING;
      }
      else if (playheadX < viewport.left) {
        this._view.viewportLeft = Math.max(0, playheadX - PADDING);
      }
    }

  }

  public updateRangeAfterZoom(oldRatio: number, newRatio: number) {
    if (this._rangeStart !== null && this._rangeEnd !== null) {
      const startMs = this._rangeStart * oldRatio;
      const endMs = this._rangeEnd * oldRatio;

      this._rangeStart = startMs / newRatio;
      this._rangeEnd = endMs / newRatio;

      this._app.editorView.drawRangeSelection(this._rangeStart, this._rangeEnd - this._rangeStart);
    }
  }

  readonly scrollRight = keepAlive(25, 300, () => {
    const viewport = this._app.editorView.viewport
    this._view.viewportLeft += (viewport.right - viewport.left) / 50
  })

  readonly scrollLeft = keepAlive(25, 300, () => {
    const viewport = this._app.editorView.viewport
    this._view.viewportLeft -= (viewport.right - viewport.left) / 50
  })

}
