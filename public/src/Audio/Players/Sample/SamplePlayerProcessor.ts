import type { AudioWorkletGlobalScope } from "@webaudiomodules/api"
import { IBaseAudioPlayerProcessor } from "../BaseAudioPlayerProcessor"


export function getSamplePlayerProcessor(moduleId:string){

    const { webAudioModules } = globalThis as unknown as AudioWorkletGlobalScope
    const { BaseAudioPlayerProcessor } = webAudioModules.getModuleScope(moduleId)

    class SamplePlayerProcessor extends BaseAudioPlayerProcessor implements IBaseAudioPlayerProcessor {

        audio: Float32Array[] | undefined
    
        constructor(options: any){
            super(options)
        }
    
        async _onMessage(e: MessageEvent<any>){
            if ("audio" in e.data){
                this.audio = e.data.audio
                this.port.postMessage({resolve:"audio"})
            }
            await super._onMessage(e)
        }
    
        play(from: number, to: number, msRate: number, inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>): void {
            if (!this.audio) return
            const bufferSize: number = outputs[0][0].length;
            const output: Float32Array[] = outputs[0];
            const channelCount = Math.min(this.audio.length, output.length)
    
            for (let channel = 0; channel < channelCount; channel++) {
                for (let i = 0; i < bufferSize; i++) {
                    // Rust側で音声を合成するため、JS側は無音を出力する
                    output[channel][i] = 0;
                }
            }
        }
    
    }
    console.log("moduleId",moduleId)
    try{ registerProcessor(moduleId, SamplePlayerProcessor) } catch(e){}
}