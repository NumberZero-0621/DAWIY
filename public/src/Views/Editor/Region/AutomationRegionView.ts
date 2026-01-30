import { Graphics } from "pixi.js";
import { HEIGHT_AUTOMATION, HEIGHT_TRACK, RATIO_MILLS_BY_PX } from "../../../Env";
import AutomationRegion from "../../../Models/Region/AutomationRegion";
import EditorView from "../EditorView";
import RegionView from "./RegionView";

export default class AutomationRegionView extends RegionView<AutomationRegion> {

    constructor(editor: EditorView, region: AutomationRegion) {
        super(editor, region);
        // Ensure interactive
        this.eventMode = 'static';
        // Position below the main track waveform
        this.y = HEIGHT_TRACK;
        // Remove mask to prevent clipping of start/end points
        this.mask = null;
    }

    /**
     * Draw content (the BPF curve and points).
     */
    protected override drawContent(target: Graphics, color: string, region: AutomationRegion, from: number, to: number): void {
        const height = HEIGHT_AUTOMATION;
        const width = region.duration / RATIO_MILLS_BY_PX; // in PX

        target.clear();

        // Draw Curve
        const points = region.points;
        const numPoints = points.length;

        if (numPoints > 0) {
            // Sort points by time just in case
            points.sort((a, b) => a.time - b.time);

            // 1. Draw Lines
            target.lineStyle(2, 0x00FF00, 1); // Green line

            for (let i = 0; i < numPoints; i++) {
                const p = points[i];
                const x = p.time / RATIO_MILLS_BY_PX;
                const y = (1 - p.value) * height;

                if (i === 0) target.moveTo(x, y);
                else target.lineTo(x, y);
            }

            // 2. Draw Points
            target.lineStyle(0); // Reset line style for points (no border)
            for (let i = 0; i < numPoints; i++) {
                const p = points[i];
                const x = p.time / RATIO_MILLS_BY_PX;
                const y = (1 - p.value) * height;

                target.beginFill(0x00FF00); // Green points
                target.drawCircle(x, y, 5); // Full circle, slightly larger
                target.endFill();
            }
        }
    }

    /** Draws the background of the region. */
    protected override drawBackground(): void {
        this._background.clear();
        // Invisible background for hit testing (alpha almost 0)
        this._background.beginFill(0x000000, 0.001);
        this._background.drawRect(0, 0, this.region_width, HEIGHT_AUTOMATION);
        this._background.endFill();

        // Selection border logic (optional, keeping minimal if needed, currently removed based on user feedback)
        if (this.isSelected) {
            this._background.lineStyle(1, 0xffffff, 0.5);
            this._background.drawRect(0, 0, this.region_width, HEIGHT_AUTOMATION);
        }
    }

    protected override updateMask(): void {
        this._customMask.clear();
    }
}
