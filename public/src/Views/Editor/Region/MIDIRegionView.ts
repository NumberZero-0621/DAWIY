import { Graphics } from "pixi.js";
import { HEIGHT_TRACK, RATIO_MILLS_BY_PX } from "../../../Env";
import MIDIRegion from "../../../Models/Region/MIDIRegion";
import EditorView from "../EditorView";
import RegionView from "./RegionView";

/**
 * Class that extends PIXI.Container.
 * It will contain the PIXI.Graphics that represents the waveform of the current region.
 */
export default class MIDIRegionView extends RegionView<MIDIRegion> {

    constructor(editor: EditorView, region: MIDIRegion) {
        super(editor,region);
    }

  

    /**
     * Draws the waveform of the track.
     *
     * @param color - The color in HEX format (#FF00FF).
     * @param region - The region that will contain the buffer to draw.
     */
    override drawContent(target: Graphics, color: string, region: MIDIRegion, from: number, to: number): void {
        let range = region.width;
        this.height=HEIGHT_TRACK
        this.scale.x = 1;

        let colorHex = +("0x" + color.slice(1));

        target.beginFill(colorHex, 0.5);

        // Get max amplitude
        let minnote=0
        let maxnote=127
        let amplitude=maxnote-minnote

        const app = this._editorView.app;
        const regionStartX = app.msToX(region.start);

        // Draw notes
        const note_height=(HEIGHT_TRACK-HEIGHT_TRACK/20)/amplitude
        region.midi.forEachNote((note, start)=>{
            const absoluteStartMs = region.start + start;
            if(absoluteStartMs + note.duration < from) return
            if(absoluteStartMs > to) return
            
            const startX = app.msToX(absoluteStartMs) - regionStartX;
            const endX = app.msToX(absoluteStartMs + note.duration) - regionStartX;

            const local_note = amplitude - (note.note - minnote)
            const y = local_note * note_height
            const x = startX
            const w = Math.max(1, endX - startX)
            const h = HEIGHT_TRACK / 128 * 5
            target.drawRect(x, y, w, h)
            target.drawRect(x + w - HEIGHT_TRACK/20, y, HEIGHT_TRACK/20, h)
        })
    }

}