import { Graphics } from "pixi.js";
import { HEIGHT_AUTOMATION, HEIGHT_TRACK, RATIO_MILLS_BY_PX } from "../../../Env";
import AutomationRegion, { CurveMode } from "../../../Models/Region/AutomationRegion";
import EditorView from "../EditorView";
import RegionView from "./RegionView";

export default class AutomationRegionView extends RegionView<AutomationRegion> {

    public selectedPointIndices: Set<number> = new Set();

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

        // Use region specific color if available, otherwise track color
        const useColor = region.color ?? color;

        // 色を16進数に変換（無効な場合はデフォルト色を使用）
        let colorHex = 0x00FF00; // デフォルト: 緑
        if (useColor && useColor.startsWith("#") && useColor.length >= 4) {
            const parsed = parseInt(useColor.replace("#", ""), 16);
            if (!isNaN(parsed)) {
                colorHex = parsed;
            }
        }

        target.clear();

        // Draw Curve
        const points = region.points;
        const numPoints = points.length;

        if (numPoints > 0) {
            // Sort points by time just in case
            points.sort((a, b) => a.time - b.time);

            // 1. Draw Lines
            target.lineStyle(2, colorHex, 1); // トラックの色

            for (let i = 0; i < numPoints; i++) {
                const p = points[i];
                const x = p.time / RATIO_MILLS_BY_PX;
                const y = (1 - p.value) * height;

                if (i === 0) {
                    // 最初のポイントへの移動
                    if (x > 0) {
                        target.moveTo(0, y); // Start from 0 time
                        target.lineTo(x, y); // Draw horizontal line to first point
                    } else {
                        target.moveTo(x, y);
                    }
                } else {
                    // 前のポイントから現在のポイントへ線を描く
                    const prevP = points[i - 1];
                    const prevX = prevP.time / RATIO_MILLS_BY_PX;
                    const prevY = (1 - prevP.value) * height;
                    const curveMode = prevP.curve ?? CurveMode.Linear;

                    this.drawCurveLine(target, prevX, prevY, x, y, curveMode, height, colorHex);
                }
            }

            // 2. Draw Points
            target.lineStyle(0); // Reset line style for points (no border)
            for (let i = 0; i < numPoints; i++) {
                const p = points[i];
                const x = p.time / RATIO_MILLS_BY_PX;
                const y = (1 - p.value) * height;

                const isSelected = this.selectedPointIndices.has(i);

                if (isSelected) {
                    target.beginFill(colorHex); // トラックの色
                    target.drawCircle(x, y, 7); // Larger circle for selected
                } else {
                    target.beginFill(colorHex); // トラックの色
                    target.drawCircle(x, y, 5); // Normal circle
                }
                target.endFill();
            }
        }
    }

    /**
     * カーブモードに応じた線を描画
     */
    private drawCurveLine(target: Graphics, x1: number, y1: number, x2: number, y2: number, curveMode: CurveMode, height: number, colorHex: number): void {
        const steps = 20; // カーブの分割数

        switch (curveMode) {
            case CurveMode.Step:
                // ジャンプ: 水平線を描いてから垂直にジャンプ（点線で描画）
                const dashLength = 4;
                const gapLength = 4;

                // 水平線の点線
                let currentX = x1;
                while (currentX < x2) {
                    const dashEndX = Math.min(currentX + dashLength, x2);
                    target.moveTo(currentX, y1);
                    target.lineTo(dashEndX, y1);
                    currentX = dashEndX + gapLength;
                }

                // 垂直線の点線
                const minY = Math.min(y1, y2);
                const maxY = Math.max(y1, y2);
                let currentY = minY;
                while (currentY < maxY) {
                    const dashEndY = Math.min(currentY + dashLength, maxY);
                    target.moveTo(x2, currentY);
                    target.lineTo(x2, dashEndY);
                    currentY = dashEndY + gapLength;
                }

                // 次のセグメントの開始位置に移動
                target.moveTo(x2, y2);
                break;

            case CurveMode.Fast:
                // ファースト: 対数的カーブ（最初に急変化）
                for (let s = 1; s <= steps; s++) {
                    const t = s / steps;
                    const curvedT = Math.sqrt(t); // 0→1 を急→緩やかに
                    const cx = x1 + (x2 - x1) * t;
                    const cy = y1 + (y2 - y1) * curvedT;
                    target.lineTo(cx, cy);
                }
                break;

            case CurveMode.Slow:
                // スロー: 指数的カーブ（後半に急変化）
                for (let s = 1; s <= steps; s++) {
                    const t = s / steps;
                    const curvedT = t * t; // 0→1 を緩やか→急に
                    const cx = x1 + (x2 - x1) * t;
                    const cy = y1 + (y2 - y1) * curvedT;
                    target.lineTo(cx, cy);
                }
                break;

            case CurveMode.Linear:
            default:
                // 直線
                target.lineTo(x2, y2);
                break;
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
