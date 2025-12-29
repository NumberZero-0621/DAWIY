import { Container, Graphics, FederatedPointerEvent, Text, Rectangle } from "pixi.js";
import MIDIRegion from "../../../Models/Region/MIDIRegion";
import Track from "../../../Models/Track/Track";
import { RATIO_MILLS_BY_PX, HEIGHT_TRACK, MAX_DURATION_SEC } from "../../../Env";
import { lightenColor } from "../../../Utils/Color";

export default class PianoRollView extends Container {

    public background: Graphics;
    public keysContainer: Container;
    public notesContainer: Container;
    public gridContainer: Container;
    public playheadContainer: Container;
    public playheadLine: Graphics;
    public selectionBox: Graphics;
    public rangeSelectionGraphics: Graphics;
    public timelineRangeGraphics: Graphics;
    public timelineContainer: Container;
    public loopContainer: Container;
    public loopBackground: Graphics;
    public loopBar: Graphics;
    public loopOverlay: Graphics;
    public loopHandleLeft: Graphics;
    public loopHandleRight: Graphics;
    public contentContainer: Container; // Holds grid and notes, scrolls
    public closeButton: Container;
    
    // Constants for visualization
    public readonly NOTE_HEIGHT = 20;
    public readonly KEY_WIDTH = 40;
    public readonly GRID_COLOR = 0x333333;
    public readonly BLACK_KEY_COLOR = 0x000000;
    public readonly WHITE_KEY_COLOR = 0xFFFFFF;
    public readonly NOTE_COLOR = 0xFF0000;
    public readonly PLAYHEAD_COLOR = 0xFFFFFF;
    public readonly SELECTION_BOX_COLOR = 0xFFFFFF;
    public readonly SELECTION_BOX_ALPHA = 0.3;
    public readonly TIMELINE_HEIGHT = 20;
    public readonly LOOP_HEIGHT = 10;
    public get HEADER_HEIGHT() { return this.LOOP_HEIGHT + this.TIMELINE_HEIGHT; }
    public readonly LOOP_COLOR_ACTIVE = 0x5C69C; // Same as LoopView
    public readonly LOOP_COLOR_INACTIVE = 0x426c8a;

    // Viewport state
    public viewportWidth: number = 800;
    public viewportHeight: number = 600;
    public scrollY: number = 0;
    public scrollX: number = 0;

    constructor() {
        super();

        this.background = new Graphics();
        this.addChild(this.background);

        this.contentContainer = new Container();
        this.addChild(this.contentContainer);

        this.gridContainer = new Container();
        this.contentContainer.addChild(this.gridContainer);

        this.notesContainer = new Container();
        this.contentContainer.addChild(this.notesContainer);

        this.timelineContainer = new Container();
        this.timelineContainer.interactive = true;
        this.contentContainer.addChild(this.timelineContainer); // Scrolls X, Fixed Y logic in updateScroll

        this.loopBackground = new Graphics();
        this.loopBackground.interactive = true;
        this.contentContainer.addChild(this.loopBackground);

        this.loopOverlay = new Graphics();
        this.loopOverlay.eventMode = 'none';
        this.contentContainer.addChild(this.loopOverlay);

        this.loopContainer = new Container();
        this.loopContainer.interactive = true;
        this.contentContainer.addChild(this.loopContainer);
        
        this.loopBar = new Graphics();
        this.loopBar.interactive = true;
        this.loopBar.cursor = "grab";
        this.loopContainer.addChild(this.loopBar);
        
        this.loopHandleLeft = new Graphics();
        this.loopHandleLeft.interactive = true;
        this.loopHandleLeft.cursor = "w-resize";
        this.loopContainer.addChild(this.loopHandleLeft);
        
        this.loopHandleRight = new Graphics();
        this.loopHandleRight.interactive = true;
        this.loopHandleRight.cursor = "e-resize";
        this.loopContainer.addChild(this.loopHandleRight);

        this.rangeSelectionGraphics = new Graphics();
        this.rangeSelectionGraphics.eventMode = 'none';
        this.contentContainer.addChild(this.rangeSelectionGraphics);

        this.timelineRangeGraphics = new Graphics();
        this.timelineRangeGraphics.eventMode = 'none';
        this.contentContainer.addChild(this.timelineRangeGraphics);

        this.playheadContainer = new Container();
        this.contentContainer.addChild(this.playheadContainer);

        this.playheadLine = new Graphics();
        this.playheadContainer.addChild(this.playheadLine);

        this.selectionBox = new Graphics();
        this.contentContainer.addChild(this.selectionBox);

        this.keysContainer = new Container();
        this.addChild(this.keysContainer); // Keys stay fixed on X axis

        this.closeButton = new Container();
        this.closeButton.interactive = true;
        this.closeButton.cursor = "pointer";
        this.addChild(this.closeButton);

        this.interactive = true;
    }

    public resize(width: number, height: number) {
        this.viewportWidth = width;
        this.viewportHeight = height;
        
        this.background.clear();
        this.background.beginFill(0x222222);
        this.background.drawRect(0, 0, width, height);
        this.background.endFill();

        this.drawKeys();
        this.drawPlayheadLine();
        this.drawCloseButton();
    }

    private drawCloseButton() {
        this.closeButton.removeChildren();
        
        const size = 30;
        const padding = 15; // Distance from top-right corner
        // Position is handled by resize or controller, but here we draw at 0,0 relative to container
        // Wait, the previous code set this.closeButton.position.set(x, y);
        // We will keep setting position here for now based on viewportWidth, 
        // but Controller might override resize to pass a "safe width".
        
        const x = this.viewportWidth - size - padding;
        const y = padding;
        
        this.closeButton.position.set(x, y);

        const g = new Graphics();
        
        // Background - Simple Black/Dark Grey
        g.beginFill(0x000000, 0.5); // Semi-transparent black
        g.lineStyle(1, 0x888888, 1);
        g.drawRect(0, 0, size, size);
        g.endFill();

        // Symmetrical X
        g.lineStyle(2, 0xFFFFFF, 1);
        const m = 8; // margin inside the button
        g.moveTo(m, m);
        g.lineTo(size - m, size - m);
        g.moveTo(size - m, m);
        g.lineTo(m, size - m);

        this.closeButton.addChild(g);
    }

    private drawPlayheadLine() {
        this.playheadLine.clear();

        const width = 12;
        const headHeight = this.HEADER_HEIGHT;
        const rectHeight = headHeight * 0.67;

        this.playheadLine.lineStyle(1, this.PLAYHEAD_COLOR);
        this.playheadLine.beginFill(this.PLAYHEAD_COLOR);

        this.playheadLine.moveTo(-width / 2, 0);
        this.playheadLine.lineTo(-width / 2, rectHeight);
        this.playheadLine.lineTo(0, headHeight);
        this.playheadLine.lineTo(0, this.viewportHeight);
        this.playheadLine.lineTo(0, headHeight);
        this.playheadLine.lineTo(width / 2, rectHeight);
        this.playheadLine.lineTo(width / 2, 0);
        this.playheadLine.lineTo(-width / 2, 0);

        this.playheadLine.endFill();
    }

    public setPlayheadPosition(x: number) {
        this.playheadLine.x = x;
    }

    public drawTimelineSelection(x: number, width: number) {
        this.timelineRangeGraphics.clear();
        this.timelineRangeGraphics.beginFill(0xFFFFFF, 0.8);
        this.timelineRangeGraphics.drawRect(x, 0, width, this.TIMELINE_HEIGHT);
        this.timelineRangeGraphics.endFill();
    }

    public clearTimelineSelection() {
        this.timelineRangeGraphics.clear();
    }

    public drawRangeSelection(x: number, width: number) {
        this.rangeSelectionGraphics.clear();
        this.rangeSelectionGraphics.beginFill(0xFFFFFF, 0.3);
        this.rangeSelectionGraphics.drawRect(x, 0, width, 128 * this.NOTE_HEIGHT);
        this.rangeSelectionGraphics.endFill();
        
        this.drawTimelineSelection(x, width);
    }

    public clearRangeSelection() {
        this.rangeSelectionGraphics.clear();
        this.clearTimelineSelection();
    }

    public drawSelectionBox(x: number, y: number, width: number, height: number) {
        this.selectionBox.clear();
        this.selectionBox.beginFill(this.SELECTION_BOX_COLOR, this.SELECTION_BOX_ALPHA);
        this.selectionBox.lineStyle(1, this.SELECTION_BOX_COLOR, 0.8);
        this.selectionBox.drawRect(x, y, width, height);
        this.selectionBox.endFill();
    }

    public clearSelectionBox() {
        this.selectionBox.clear();
    }

    public drawKeys() {
        this.keysContainer.removeChildren();
        const startNote = 0;
        const endNote = 127;
        
        // Background for keys header (corner)
        const headerBg = new Graphics();
        headerBg.beginFill(0x333333);
        headerBg.drawRect(0, 0, this.KEY_WIDTH, this.HEADER_HEIGHT);
        headerBg.endFill();
        this.keysContainer.addChild(headerBg);
        
        for (let i = startNote; i <= endNote; i++) {
            const y = (127 - i) * this.NOTE_HEIGHT - this.scrollY + this.HEADER_HEIGHT;
            if (y < this.HEADER_HEIGHT - this.NOTE_HEIGHT || y > this.viewportHeight) continue; // Clip with header consideration

            const key = new Graphics();
            const isBlack = [1, 3, 6, 8, 10].includes(i % 12);
            
            key.beginFill(isBlack ? this.BLACK_KEY_COLOR : this.WHITE_KEY_COLOR);
            key.lineStyle(1, 0x888888);
            key.drawRect(0, 0, this.KEY_WIDTH, this.NOTE_HEIGHT);
            key.endFill();
            key.y = y;
            this.keysContainer.addChild(key);

             // Draw note name on C
             if (i % 12 === 0) {
                const text = new Text(`C${i/12 - 1}`, { fontFamily: "Arial", fontSize: 10, fill: isBlack ? 0xFFFFFF : 0x000000 });
                text.x = 2;
                text.y = y + 2;
                this.keysContainer.addChild(text);
            }
        }
    }

    public drawGrid(duration: number, timeSignature: [number, number] = [4, 4], bpm: number = 120, snapResolution: number = 4, snapTriplet: boolean = false) {
        this.gridContainer.removeChildren();
        this.timelineContainer.removeChildren();

        // Use MAX_DURATION_SEC for global timeline if duration is not provided or to ensure coverage
        const maxDuration = Math.max(duration, MAX_DURATION_SEC * 1000); 
        const width = maxDuration / RATIO_MILLS_BY_PX;
        
        const g = new Graphics();

        // Timeline Background
        const timelineBg = new Graphics();
        timelineBg.beginFill(0x3c4044);
        timelineBg.drawRect(0, 0, width, this.TIMELINE_HEIGHT);
        timelineBg.endFill();
        this.timelineContainer.addChild(timelineBg);

        // Timeline Lines Graphics
        const timelineG = new Graphics();
        this.timelineContainer.addChild(timelineG);

        // Draw row backgrounds (Lighter for white keys)
        for (let i = 0; i <= 127; i++) {
            const y = (127 - i) * this.NOTE_HEIGHT;
            const isBlack = [1, 3, 6, 8, 10].includes(i % 12);
            
            if (!isBlack) {
                // White key: draw lighter background
                g.beginFill(0xFFFFFF, 0.04); // 4% opacity white overlay
                g.drawRect(0, y, width, this.NOTE_HEIGHT);
                g.endFill();
            }
        }

        // Horizontal lines (rows)
        g.lineStyle(1, this.GRID_COLOR);
        for (let i = 0; i <= 127; i++) {
             const y = (127 - i) * this.NOTE_HEIGHT;
             g.moveTo(0, y);
             g.lineTo(width, y);
        }

        // Loop Area Background
        this.loopBackground.clear();
        this.loopBackground.beginFill(0x2c353c);
        this.loopBackground.drawRect(0, 0, width, this.LOOP_HEIGHT);
        this.loopBackground.endFill();

        // Vertical lines
        const msPerBeat = 60000 / bpm; // Duration of a quarter note
        const beatWidth = msPerBeat / RATIO_MILLS_BY_PX;
        const beatsPerBar = timeSignature[0]; // Assuming quarter note denominator for simplicity or standard mapping
        // TODO: Handle timeSignature[1] properly if it's not 4
        
        // Calculate snap width
        let snapDuration = (4 / snapResolution) * msPerBeat;
        if (snapTriplet) {
            snapDuration = snapDuration * 2 / 3;
        }
        const snapWidth = snapDuration / RATIO_MILLS_BY_PX;
        
        // Avoid infinite loop if snapWidth is too small or zero
        const safeSnapWidth = Math.max(1, snapWidth);

        // Colors
        const BAR_LINE_COLOR = 0xAAAAAA;
        const BEAT_LINE_COLOR = 0x666666; // Darker/more visible than original 0x333333
        const SNAP_LINE_COLOR = 0x333333; // Faint line for subdivisions

        for (let x = 0; x <= width; x += safeSnapWidth) {
            // Check alignment with beats and bars
            // We use a small epsilon because floating point arithmetic
            const epsilon = 1.0; 
            
            // Find closest beat index
            const beatIndex = Math.round(x / beatWidth);
            const distToBeat = Math.abs(x - beatIndex * beatWidth);
            const isBeat = distToBeat < epsilon;
            
            const isBarStart = isBeat && (beatIndex % beatsPerBar === 0);

            if (isBarStart) {
                // Bar line: Thicker and brighter
                g.lineStyle(2, BAR_LINE_COLOR); 
                g.moveTo(x, 0);
                g.lineTo(x, 128 * this.NOTE_HEIGHT);

                // Timeline Bar Line (Full Height)
                timelineG.lineStyle(2, BAR_LINE_COLOR);
                timelineG.moveTo(x, 0);
                timelineG.lineTo(x, this.TIMELINE_HEIGHT);

                // Bar Number in Timeline
                const barNum = (beatIndex / beatsPerBar) + 1;
                
                const text = new Text(`${barNum}`, { fontFamily: "Arial", fontSize: 12, fill: 0xCCCCCC });
                text.x = x + 5;
                text.y = 2; 
                this.timelineContainer.addChild(text); 

            } else if (isBeat) {
                // Beat line: Medium visibility
                g.lineStyle(1, BEAT_LINE_COLOR);
                g.moveTo(x, 0);
                g.lineTo(x, 128 * this.NOTE_HEIGHT);

                // Timeline Beat Line (Full Height)
                timelineG.lineStyle(1, BEAT_LINE_COLOR);
                timelineG.moveTo(x, 0);
                timelineG.lineTo(x, this.TIMELINE_HEIGHT);

            } else {
                // Snap sub-division line: Faint
                // Only draw if snap resolution is finer than beat
                g.lineStyle(1, SNAP_LINE_COLOR);
                g.moveTo(x, 0);
                g.lineTo(x, 128 * this.NOTE_HEIGHT);

                // Timeline Snap Line (Bite in)
                timelineG.lineStyle(1, SNAP_LINE_COLOR);
                timelineG.moveTo(x, this.TIMELINE_HEIGHT - 10);
                timelineG.lineTo(x, this.TIMELINE_HEIGHT);
            }
        }

        this.gridContainer.addChildAt(g, 0); // Add graphics behind text
        this.gridContainer.x = this.KEY_WIDTH - this.scrollX;
        this.gridContainer.y = -this.scrollY + this.HEADER_HEIGHT; // Offset grid by header
        
        // Timeline moves X but fixed Y
        this.timelineContainer.x = this.KEY_WIDTH - this.scrollX;
        this.timelineContainer.y = this.LOOP_HEIGHT;
    }

    public drawNotes(track: Track, color: number = this.NOTE_COLOR, selectedNotes: Set<any> | null = null) {
        this.notesContainer.removeChildren();
        this.notesContainer.x = this.KEY_WIDTH - this.scrollX;
        this.notesContainer.y = -this.scrollY + this.HEADER_HEIGHT; // Offset notes by header

        for (const region of track.regions) {
            if (region instanceof MIDIRegion) {
                region.midi.forEachNote((note, start) => {
                    const rect = new Graphics();
                    
                    const isSelected = selectedNotes ? selectedNotes.has(note) : false;
                    const fillColor = isSelected ? lightenColor(color, 0.5) : color; 
                    
                    // Global position: Region Start + Note Start
                    const globalStart = region.start + start;
                    
                    const x = globalStart / RATIO_MILLS_BY_PX;
                    const y = (127 - note.note) * this.NOTE_HEIGHT;
                    const w = Math.max(5, note.duration / RATIO_MILLS_BY_PX);
                    const h = this.NOTE_HEIGHT;

                    rect.beginFill(fillColor);
                    rect.lineStyle(1, 0xFFFFFF); // White border
                    rect.drawRect(0, 0, w, h);
                    rect.endFill();
                    rect.position.set(x, y);

                    // Add interactivity to the note graphics
                    rect.interactive = true;
                    rect.cursor = "pointer"; // Change cursor to hand
                    // @ts-ignore
                    rect.noteData = { note, start, region, w, h }; 
                    
                    this.notesContainer.addChild(rect);
                });
            }
        }
    }

    public refreshNoteSelection(selectedNotes: Set<any>, trackColor: number) {
        for (const child of this.notesContainer.children as any[]) {
            if (child.noteData) {
                const isSelected = selectedNotes.has(child.noteData.note);
                const fillColor = isSelected ? lightenColor(trackColor, 0.5) : trackColor;
                
                const g = child as Graphics;
                const { w, h } = child.noteData;
                g.clear();
                g.beginFill(fillColor);
                g.lineStyle(1, 0xFFFFFF); // Keep white border
                g.drawRect(0, 0, w, h);
                g.endFill();
            }
        }
    }

    public drawLoop(startPx: number, endPx: number, active: boolean) {
        const color = active ? this.LOOP_COLOR_ACTIVE : this.LOOP_COLOR_INACTIVE;
        const alpha = 0.2;
        const height = this.LOOP_HEIGHT;
        const fullHeight = 128 * this.NOTE_HEIGHT;
        
        this.loopBar.clear();
        this.loopOverlay.clear();
        this.loopHandleLeft.clear();
        this.loopHandleRight.clear();
        
        // Background on Timeline
        this.loopBar.beginFill(color, alpha);
        this.loopBar.drawRect(startPx, 0, endPx - startPx, height);
        this.loopBar.endFill();

        // Loop Region Overlay (Full Height)
        if (active) {
            this.loopOverlay.beginFill(color, alpha * 0.5);
            this.loopOverlay.drawRect(startPx, 0, endPx - startPx, fullHeight);
            this.loopOverlay.endFill();
        }
        
        // Handles
        const handleW = 10;
        
        this.loopHandleLeft.beginFill(color, 1);
        this.loopHandleLeft.drawRect(0, 0, handleW, height);
        this.loopHandleLeft.endFill();
        this.loopHandleLeft.x = startPx;
        // @ts-ignore
        this.loopHandleLeft.hitArea = new Rectangle(0, 0, handleW, height);
        
        this.loopHandleRight.beginFill(color, 1);
        this.loopHandleRight.drawRect(0, 0, handleW, height);
        this.loopHandleRight.endFill();
        this.loopHandleRight.x = endPx - handleW;
        // @ts-ignore
        this.loopHandleRight.hitArea = new Rectangle(0, 0, handleW, height);
    }

    public updateScroll(dx: number, dy: number) {
        this.scrollX = Math.max(0, this.scrollX + dx);
        // Clamp scrollY
        const maxScrollY = 128 * this.NOTE_HEIGHT - this.viewportHeight + this.HEADER_HEIGHT;
        const newScrollY = Math.max(0, Math.min(this.scrollY + dy, maxScrollY));
        
        if (newScrollY !== this.scrollY) {
            this.scrollY = newScrollY;
            this.drawKeys();
        }
        
        this.gridContainer.x = this.KEY_WIDTH - this.scrollX;
        this.gridContainer.y = -this.scrollY + this.HEADER_HEIGHT;
        this.notesContainer.x = this.KEY_WIDTH - this.scrollX;
        this.notesContainer.y = -this.scrollY + this.HEADER_HEIGHT;
        
        this.loopContainer.x = this.KEY_WIDTH - this.scrollX;
        this.loopContainer.y = 0;

        this.loopBackground.x = this.KEY_WIDTH - this.scrollX;
        this.loopBackground.y = 0;

        this.loopOverlay.x = this.KEY_WIDTH - this.scrollX;
        this.loopOverlay.y = -this.scrollY + this.HEADER_HEIGHT;
        
        // Playhead only scrolls in X, not Y (it covers full height)
        this.playheadContainer.x = this.KEY_WIDTH - this.scrollX;
        this.playheadContainer.y = 0; // Playhead covers everything including timeline
        
        this.timelineContainer.x = this.KEY_WIDTH - this.scrollX;
        this.timelineContainer.y = this.LOOP_HEIGHT;

        this.rangeSelectionGraphics.x = this.KEY_WIDTH - this.scrollX;
        this.timelineRangeGraphics.x = this.KEY_WIDTH - this.scrollX;
        
        this.rangeSelectionGraphics.y = -this.scrollY + this.HEADER_HEIGHT;
        this.timelineRangeGraphics.y = this.LOOP_HEIGHT;
    }
}
