import { Container, Graphics } from "pixi.js";
import TrackElement from "../../Components/Editor/TrackElement";
import { HEIGHT_TRACK, HEIGHT_AUTOMATION, RATIO_MILLS_BY_PX } from "../../Env";
import Region from "../../Models/Region/Region";
import Track from "../../Models/Track/Track";
import EditorView from "./EditorView";
import RegionView from "./Region/RegionView";

/**
 * Class that extends PIXI.Container.
 * It will contain the PIXI.Graphics that represents the waveform of the current track.
 */
export default class WaveformView extends Container {

    /**
     * Array of RegionView that contains the regions of the track.
     */
    public regionViews: RegionView<any>[];
    /**
     * The unique ID of the track.
     */
    public trackId: number;
    /**
     * The color of the track.
     */
    public color: string;

    /**
     * The track associated with this waveform.
     */
    public track: Track;

    /**
     * The main editor of the application.
     */
    private _editorView: EditorView;

    public ghostAutomationGraphics: Graphics;

    constructor(editor: EditorView, track: Track) {
        super();
        this._editorView = editor;
        this.trackId = track.id;
        this.color = track.color || "#ffcc00";
        this.track = track;


        this.regionViews = [];

        this.eventMode = "dynamic";
        this._editorView.viewport.addChild(this);

        this.zIndex = -10;

        this.sortableChildren = true;
        this.ghostAutomationGraphics = new Graphics();
        this.ghostAutomationGraphics.zIndex = 50;
        this.addChild(this.ghostAutomationGraphics);

        if (this.trackId !== -1) {
            this.setPos(track);
        } else {
            this.position.x = 0;
            this.position.y = 0; // Default, will be reset by resizeCanvas
        }
    }

    /**
     * Adds a RegionView to the array of RegionView.
     * It will initialize the RegionView with the color and the region.
     *
     * @param region - The region that will contain the buffer to draw.
     * @param regionView - The RegionView to add.
     */
    public addRegionView(region: Region, regionView: RegionView<any>): void {
        this.regionViews.push(regionView);
        this.addChild(regionView);
        regionView.initializeRegionView(this.color, region);
    }

    /**
     * Removes the RegionView from the array of RegionView and from the PIXI.Container.
     *
     * @param regionView - The RegionView to remove.
     */
    public removeRegionView(regionView: RegionView<any>): void {
        let index = this.regionViews.indexOf(regionView);
        this.regionViews.splice(index, 1);
        this.removeChild(regionView);
    }

    /**
     * Returns the RegionView that has the given regionId.
     *
     * @param regionId - The unique ID of the region.
     * @returns The RegionView that has the given regionId.
     */
    public getRegionViewById(regionId: number): RegionView<any> | undefined {
        return this.regionViews.find(regionView => regionView.id === regionId);
    }

    /**
     * Set the position of the track in the track container taking into account only the track-elements
     *
     * @param track - The track to set the position.
     * @private
     */
    private setPos(track: Track): void {
        let trackContainer = document.getElementById("track-container") as HTMLDivElement;
        let pos = Array.from(trackContainer.children).filter(e => e instanceof TrackElement).indexOf(track.element);

        this.position.x = 0;
        this.position.y = pos * HEIGHT_TRACK + 25;
    }

    public updateAutomationPositions(): void {
        const track = this.track || this._editorView.app.host;
        const automationRegions = this.trackId === -1 ? (this._editorView.app.host.bpmAutomationRegion ? [this._editorView.app.host.bpmAutomationRegion] : []) : this.track.automationRegions;

        for (let regionView of this.regionViews) {
            const index = automationRegions.findIndex(r => r.id === regionView.id);
            if (index !== -1) {
                const baseHeight = (this.track && this.trackId !== -1) ? HEIGHT_TRACK : 0;
                regionView.y = baseHeight + (index * HEIGHT_AUTOMATION);
            }
        }
    }

    public drawGhostAutomations() {
        if (this.trackId === -1 || !this.track) return; // Host doesn't have ghost automations yet
        
        this.ghostAutomationGraphics.clear();

        const openParams = new Set(this.track.automationRegions.map(r => r.paramId));

        for (const [paramId, points] of this.track.automationData) {
            if (openParams.has(paramId)) continue;
            if (points.length < 2) continue;
// ...

            // Check if values change (simple logic: not flat)
            let hasChange = false;
            const firstVal = points[0].value;
            for (let i = 1; i < points.length; i++) {
                if (points[i].value !== firstVal) {
                    hasChange = true;
                    break;
                }
            }
            if (!hasChange) continue;

            const colorStr = this.track.automationColors.get(paramId) || this.track.color;
            let color = 0xAAAAAA;
            if (colorStr.startsWith("#")) {
                color = parseInt(colorStr.replace("#", ""), 16);
            }

            this.ghostAutomationGraphics.lineStyle(1, color, 0.4);

            const app = this._editorView.app;
            this.ghostAutomationGraphics.moveTo(app.msToX(points[0].time), HEIGHT_TRACK * (1 - points[0].value));
            for (let i = 1; i < points.length; i++) {
                this.ghostAutomationGraphics.lineTo(app.msToX(points[i].time), HEIGHT_TRACK * (1 - points[i].value));
            }
        }
    }

}