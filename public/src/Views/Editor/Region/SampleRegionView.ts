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
        let isRustBuffer = region.buffer instanceof RustAudioBuffer;

        for (let channel = 0; channel < numChannels; channel++) {
            let channelOffset = isStereo ? channel * channelHeight : 0;
            
            if (isRustBuffer) {
                let rustBuffer = region.buffer as unknown as RustAudioBuffer;
                let peaks = rustBuffer.peaks;
                let numChunks = Math.floor(peaks.length / 2); 
                const chunkDurationMs = region.duration / numChunks;
                
                for (let i = 0; i < regionWidth; i++) {
                    const tCurrent = app.xToMs(regionStartX + i);
                    const tNext = app.xToMs(regionStartX + i + 1);
                    
                    const relativeStartMs = tCurrent - region.start;
                    const relativeEndMs = tNext - region.start;
                    
                    let startChunk = Math.floor(relativeStartMs / chunkDurationMs);
                    let endChunk = Math.max(startChunk + 1, Math.floor(relativeEndMs / chunkDurationMs));
                    
                    if (startChunk >= numChunks) break;
                    if (endChunk > numChunks) endChunk = numChunks;
                    
                    let min = 1.0;
                    let max = -1.0;
                    for (let c = startChunk; c < endChunk; c++) {
                        let cMin = peaks[c * 2];
                        let cMax = peaks[c * 2 + 1];
                        if (cMin < min) min = cMin;
                        if (cMax > max) max = cMax;
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
            } else {
                let data = region.buffer.getChannelData(channel);
                for (let i = 0; i < regionWidth; i++) {
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

}