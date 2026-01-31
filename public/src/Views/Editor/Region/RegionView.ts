import { Container, Graphics } from "pixi.js";
import { HEIGHT_TRACK, RATIO_MILLS_BY_PX } from "../../../Env";
import { RegionOf } from "../../../Models/Region/Region";
import { debounce } from "../../../Utils/gui_callback";
import EditorView from "../EditorView";

/**
 * Class that extends PIXI.Container.
 * It will contain the PIXI.Graphics that represents the waveform of the current region.
 */
export default abstract class RegionView<REGION extends RegionOf<REGION>> extends Container {

    /** The unique ID of the track that contains the region. */
    public trackId: number;

    /** The unique ID of the region. */
    public id: number;

    /** The main editor of the application. */
    private _editorView: EditorView;

    /** The PIXI.Graphics that represent the waveform. */
    private _wave: Graphics;

    /** The background of the region, borders included. */
    protected _background: Graphics;

    /** The mask of the region. */
    protected _customMask: Graphics;

    /** The contained region  */
    protected region_width: number;



    constructor(editor: EditorView, region: REGION) {
        super();
        this.eventMode = "dynamic";

        this._editorView = editor;
        this.trackId = region.trackId;
        this.id = region.id;

        this._background = new Graphics();
        this._wave = new Graphics();
        this._customMask = new Graphics();
        this.addChild(this._background);
        this.addChild(this._wave);
        this.addChild(this._customMask);
        this.mask = this._customMask;
    }

    /**
     * Initializes the region view given the region and the color.
     * It will set the position of the region depending on the ratio of pixels by milliseconds.
     * It will also draw the wave and the background.
     *
     * @param color - The color in HEX format (#FF00FF).
     * @param region - The region that will contain the buffer to draw.
     */
    public initializeRegionView(color: string, region: REGION): void {
        this.position.x = region.pos
        this.region_width = region.width
        this._wave.position.x = 0;

        // 初期色を保存
        if (color && color.length > 0) {
            this._lastColor = color;
        }

        this.drawContent(this._wave, color, region, 0, region.duration)
        this.drawBackground()
        this.updateMask()
    }

    /**
     * Redraw the full content of the region.
     * @param target 
     * @param color 
     * @param region 
     * @param start 
     */
    protected abstract drawContent(target: Graphics, color: string, region: REGION, from: number, to: number): void

    /** 最後に使用された色を保存 */
    private _lastColor: string = "";

    public redraw(color: string, region: REGION) {
        // 色が指定された場合は保存、空の場合は保存された色を使用
        if (color && color.length > 0) {
            this._lastColor = color;
        }
        const useColor = this._lastColor || color;

        this.region_width = region.width
        this._wave.position.x = 0;
        this.drawBackground()
        this.updateMask()
        this._wave.clear()
        this.drawContent(this._wave, useColor, region, 0, region.duration)
    }

    /**
     * Draw the region on the given target, in the given color, in the given region, from the given start to the given end (in milliseconds).
     * @param color 
     * @param region 
     * @param start 
     * @param from 
     */
    public draw(color: string, region: REGION, start: number = 0, from: number = region.duration) {
        this.region_width = region.width
        this._wave.position.x = 0;
        this.drawBackground()
        this.updateMask()
        this.drawContent(this._wave, color, region, start, from)
    }

    redrawSoon = debounce(this.redraw.bind(this), 1000)


    /** Is the region selected or not. Use to draw the current border of the background. */
    public set isSelected(value: boolean) {
        this._isSelected = value
        if (value) this._isSubSelected = false
        this.drawBackground();
    }

    public get isSelected() { return this._isSelected }

    private _isSelected = false


    /** Is the region secondary selected or not. Use to draw the current border of the background. */
    public set isSubSelected(value: boolean) {
        this._isSubSelected = value
        if (value) this._isSelected = false
        this.drawBackground()
    }

    public get isSubSelected() { return this._isSubSelected }

    private _isSubSelected = false


    /**
     * Updates the region view to simulate trimming/extending without stretching the content.
     *
     * @param duration - The new duration in seconds.
     * @param start - The new start position in milliseconds.
     * @param originalStart - The original start position in milliseconds (before resize began).
     */
    public stretch(duration: number, start: number, originalStart: number): void {
        this.scale.x = 1;
        const newWidth = (duration * 1000) / RATIO_MILLS_BY_PX;

        // Update position
        this.position.x = start / RATIO_MILLS_BY_PX;

        // Shift content to counter-act the position change, keeping it stationary in world space
        // if start > originalStart (shrunk from left), we moved right. Content must move left.
        // offset = originalStart - start. 
        // e.g. orig=0, start=100. offset=-100.
        const offset = (originalStart - start) / RATIO_MILLS_BY_PX;
        this._wave.position.x = offset;

        // Update visual width (background and mask)
        // We temporarily update region_width for drawBackground to work, 
        // but we don't save it permanently as 'region.width' until commit.
        // Actually, drawBackground uses this.region_width.
        this.region_width = newWidth;
        this.drawBackground();
        this.updateMask();
    }

    protected updateMask(): void {
        this._customMask.clear();
        this._customMask.beginFill(0x000000);
        this._customMask.drawRect(0, 0, this.region_width, HEIGHT_TRACK);
        this._customMask.endFill();
    }

    /** Draws the background of the region. It will check if the region is selected or not to draw the border. */
    protected drawBackground(): void {
        let color
        if (this.isSelected) color = 0xffffff
        else if (this.isSubSelected) color = 0xffaa00
        else color = 0x000000
        this._background.clear();
        this._background.beginFill(0xffffff, 0.3);
        this._background.lineStyle({ width: 1, color: color });
        this._background.drawRect(0, 0, this.region_width, HEIGHT_TRACK - 1);
    }

    /**
     * Returns the visual width of the region (defined by the background/mask),
     * ignoring the potentially larger bounds of the waveform content.
     */
    public override get width(): number {
        return this.region_width * this.scale.x;
    }

}