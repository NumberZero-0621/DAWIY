import { Graphics } from "pixi.js";
import { HEIGHT_TRACK } from "../../../Env";
import SampleRegion from "../../../Models/Region/SampleRegion";
import EditorView from "../EditorView";
import RegionView from "./RegionView";

/**
 * Class that extends PIXI.Container.
 * It will contain the PIXI.Graphics that represents the waveform of the current region.
 */
export default class SampleRegionView extends RegionView<SampleRegion> {

    constructor(editor: EditorView, region: SampleRegion) {
        super(editor, region)
    }

    /**
     * Draws the waveform of the track.
     *
     * @param color - The color in HEX format (#FF00FF).
     * @param region - The region that will contain the buffer to draw.
     */
    override drawContent(target: Graphics, color: string, region: SampleRegion, from: number, to: number): void {
        const app = this._editorView.app;
        const regionStartX = app.msToX(region.start);
        const regionEndX = app.msToX(region.start + region.duration);
        const regionWidth = regionEndX - regionStartX;
        
        this.scale.x = 1;

        let colorHex = +("0x" + color.slice(1));
        target.beginFill(colorHex, 0.8);

        let numChannels = region.buffer.numberOfChannels;
        let isStereo = numChannels === 2;
        let channelHeight = isStereo ? HEIGHT_TRACK / 2 : HEIGHT_TRACK;
        let amp = (channelHeight - 1) / 2;

        const sampleRate = region.buffer.sampleRate;

        for (let channel = 0; channel < numChannels; channel++) {
            let data = region.buffer.getChannelData(channel);
            let channelOffset = isStereo ? channel * channelHeight : 0;

            let lastSampleIdx = 0;

            for (let i = 0; i < regionWidth; i++) {
                // Determine the time interval for this pixel
                const tCurrent = app.xToMs(regionStartX + i);
                const tNext = app.xToMs(regionStartX + i + 1);
                
                const relativeStartMs = tCurrent - region.start;
                const relativeEndMs = tNext - region.start;
                
                const startSample = Math.floor(relativeStartMs * sampleRate / 1000);
                const endSample = Math.max(startSample + 1, Math.floor(relativeEndMs * sampleRate / 1000));
                
                if (startSample >= data.length) break;

                let min = 1.0;
                let max = -1.0;
                for (let s = startSample; s < endSample && s < data.length; s++) {
                    let datum = data[s];
                    if (datum < min) min = datum;
                    if (datum > max) max = datum;
                }
                
                const rectWidth = 1;
                let rectHeight = Math.max(1, (max - min) * amp);
                let y = channelOffset + (1 + min) * amp;
                
                if (rectHeight < channelHeight) {
                    target.drawRect(i, y, rectWidth, rectHeight);
                } else {
                    target.drawRect(i, channelOffset, rectWidth, channelHeight);
                }
            }
        }
    }

}