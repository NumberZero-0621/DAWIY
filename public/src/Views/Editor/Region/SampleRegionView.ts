import { Graphics } from "pixi.js";
import { HEIGHT_TRACK } from "../../../Env";
import SampleRegion from "../../../Models/Region/SampleRegion";
import EditorView from "../EditorView";
import RegionView from "./RegionView";
import RustAudioBuffer from "../../../Audio/RustAudioBuffer";

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
        let range = region.width;
        this.scale.x = 1;

        let colorHex = +("0x" + color.slice(1));
        // use some color transparency as regions can overlap
        target.beginFill(colorHex, 0.8);

        let numChannels = region.buffer.numberOfChannels;
        let isStereo = numChannels === 2;
        let channelHeight = isStereo ? HEIGHT_TRACK / 2 : HEIGHT_TRACK;
        let amp = (channelHeight - 1) / 2;

        let fromX = Math.floor(from / region.duration * range);
        let toX = Math.floor(to / region.duration * range);

        let isRustBuffer = region.buffer instanceof RustAudioBuffer;

        for (let channel = 0; channel < numChannels; channel++) {
            let channelOffset = isStereo ? channel * channelHeight : 0;
            
            if (isRustBuffer) {
                let rustBuffer = region.buffer as unknown as RustAudioBuffer;
                let peaks = rustBuffer.peaks;
                let numChunks = Math.floor(peaks.length / 2);
                
                for (let i = fromX; i < toX; i++) {
                    let chunkIndex = Math.floor((i / range) * numChunks);
                    if (chunkIndex >= numChunks) chunkIndex = numChunks - 1;
                    
                    let min = peaks[chunkIndex * 2];
                    let max = peaks[chunkIndex * 2 + 1];
                    
                    const rectWidth = 1;
                    let rectHeight = Math.max(1, (max - min) * amp);
                    let y = channelOffset + (1 + min) * amp;
                    
                    if (rectHeight < channelHeight) {
                        target.drawRect(i, y, rectWidth, rectHeight);
                    } else {
                        rectHeight = channelHeight;
                        target.drawRect(i, channelOffset, rectWidth, rectHeight);
                    }
                }
            } else {
                let data = region.buffer.getChannelData(channel);
                let step = Math.round(data.length / range);

                for (let i = fromX; i < toX; i++) {
                    let min = 1.0;
                    let max = -1.0;
                    for (let j = 0; j < step; j++) {
                        let dataum = data[i * step + j];
                        if (dataum < min) min = dataum;
                        if (dataum > max) max = dataum;
                    }
                    const rectWidth = 1;
                    let rectHeight = Math.max(1, (max - min) * amp);

                    // MB: we need to clip the rectangle so that if does not go over track/channel dimensions
                    let y = channelOffset + (1 + min) * amp;
                    if (rectHeight < channelHeight) {
                        target.drawRect(i, y, rectWidth, rectHeight);
                    } else {
                        rectHeight = channelHeight;
                        target.drawRect(i, channelOffset, rectWidth, rectHeight);
                    }
                }
            }
        }
    }
}