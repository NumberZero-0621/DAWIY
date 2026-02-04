import type { AudioWorkletGlobalScope } from "@webaudiomodules/api"
import type { MIDIInstant } from "../../MIDI/MIDI"
import type { IBaseAudioPlayerProcessor } from "../BaseAudioPlayerProcessor"


export function getMIDIPlayerProcessor(moduleId: string) {

    const { webAudioModules } = globalThis as unknown as AudioWorkletGlobalScope
    const { BaseAudioPlayerProcessor } = webAudioModules.getModuleScope(moduleId)


    class MIDIPlayerProcessor extends BaseAudioPlayerProcessor implements IBaseAudioPlayerProcessor {

        instants: MIDIInstant[] | undefined
        instant_duration = 1000
        current_channel = 0

        constructor(options: any) {
            super(options)
        }

        async _onMessage(e: MessageEvent<any>) {
            if ("instants" in e.data) {
                this.instants = e.data.instants
                this.port.postMessage({ resolve: "midi" })
            }
            if ("instant_duration" in e.data) this.instant_duration = e.data.instant_duration
            await super._onMessage(e)
        }

        static ANTI_LATENCY = 0
        play(from: number, to: number, msRate: number, inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>): void {
            if (!this.instants) return

            const { ANTI_LATENCY } = MIDIPlayerProcessor

            from += ANTI_LATENCY
            to += ANTI_LATENCY

            // Get the instant
            let fromInstantI = Math.max(Math.floor(from / this.instant_duration), 0)
            let toInstantI = Math.min(Math.floor(to / this.instant_duration), this.instants.length - 1)
            if (fromInstantI >= this.instants.length) return

            for (let instantI = fromInstantI; instantI <= toInstantI; instantI++) {
                let instant = this.instants[instantI]

                // Get the from and to locally in the instant
                let localFrom = from - this.instant_duration * instantI
                let localTo = to - this.instant_duration * instantI
                let selectedNote = -1
                for (const { offset, note } of instant) {
                    if (localFrom <= offset && offset < localTo) {
                        selectedNote = note.note
                        /*const freq= note.note
                        const velo= note.velocity*100
                        const chan= note.channel
                        const type= note.duration==0 ? 0x90 : 0x80
                        this.emitEvents(
                            { type: 'wam-midi', time: currentTime, data: { bytes: new Uint8Array([type | chan, freq, velo]) } },
                        );*/
                        this.emitEvents(
                            { type: 'wam-midi', time: currentTime + ANTI_LATENCY / 1000, data: { bytes: new Uint8Array([0x90 | this.current_channel, note.note, note.velocity * 127]) } },
                            //{ type: 'wam-midi', time: currentTime+ANTI_LATENCY/1000+note.duration/1000, data: { bytes: new Uint8Array([0x90 | this.current_channel, note.note, 0]) } },
                            { type: 'wam-midi', time: currentTime + ANTI_LATENCY / 1000 + note.duration / 1000, data: { bytes: new Uint8Array([0x80 | this.current_channel, note.note, note.velocity * 127]) } },
                        );

                        // Send to Main Thread for External MIDI Output
                        this.port.postMessage({
                            type: 'midi_out',
                            messages: [
                                [0x90 | this.current_channel, note.note, Math.floor(note.velocity * 127)],
                                // Note Offは時間差が必要だが、リアルタイム送信の制約上、今すぐ送るわけにはいかない。
                                // しかしAudioWorkletからは「今」送ることしかできない。
                                // Note Offの処理はこのループ内で完結しているわけではない（シーケンサーのループ）。
                                // このProcessorは「今鳴らすべきノート」を処理している。
                                // 0x80 (Note Off) は note.duration 後に送る必要がある。
                                // 残念ながら、単発のpostMessageで「n秒後に送って」はできないので、
                                // ここのロジックは「Note On」と「Note Off」がセットで即時発行されている（emitEventsは時刻指定があるが）。
                                // 外部MIDIへの送信は「スケジュールされたイベント」をRust側で管理していないため、
                                // 「発火タイミングが来たとき」に送る必要がある。

                                // ここは「イベント発行時点で」データを送るが、
                                // イベントにはタイムスタンプが含まれている。
                                // しかしemitEventsの引数を見ると、NoteOnとNoteOffを同時に登録している。
                            ]
                        });
                        // Note Offをどうするか？
                        // emitEventsはあくまで「予定表への登録」。
                        // 外部MIDI送信も「予定」として扱いたいが、現在はRustへ「即時送信」しかない。
                        // 正確にやるなら、Processor内で「現在時刻になったらpostMessageする」ロジックが必要。
                        // `process`メソッドは毎フレーム呼ばれるので、そこでスケジュール管理をするのが正しい。
                        // しかし既存コードは `instants` (プリ計算されたノート情報) を見て、
                        // `from` から `to` の間に開始するノートを探して `emitEvents` している。

                        // つまり、このループで見つかったノートは「今（厳密にはこのブロック期間中に）開始するノート」である。
                        // NoteOn は今送って良い。
                        // NoteOff は `note.duration` 後である。
                        // `note.duration` 後に再度ここに来るわけではない。

                        /* 
                           既存の実装の問題点：
                           `emitEvents` には time パラメータがあり、WAMホストがそれを解釈して適切な時間に処理する。
                           Rustへの即時送信だと、NoteOffも同時に送ると一瞬で音が止まる。
                           
                           解決策：
                           NoteOffのタイミング制御をどこでやるか。
                           1. Processor内で `setTimeout` は使えない。
                           2. `process` メループ内で、現在アクティブなノートを管理し、終了時間に来たらNoteOffを送る。
                           
                           これは結構な改修になる。
                           
                           簡易的な解決策：
                           Node側（メインスレッド）で `setTimeout` する。
                           AudioWorkletから「NoteOn, duration」を送る -> Nodeが受信 -> NoteOn送信 -> setTimeout(()=>NoteOff送信, duration)。
                           JavaScriptの `setTimeout` は精度が悪いが、外部MIDIなら許容範囲かもしれない。
                        */
                        this.port.postMessage({
                            type: 'midi_out_trigger',
                            channel: this.current_channel,
                            note: note.note,
                            // velocity calculation fix: note.velocity might be 0-127 or 0.0-1.0
                            // If > 1, assume it is already scaled (e.g. 100).
                            // Clamp to 127.
                            velocity: Math.min(127, Math.floor(note.velocity > 1 ? note.velocity : note.velocity * 127)),
                            duration: note.duration // ms
                        });
                    }
                }
            }
        }


        _prepareProcessing(duration: number): boolean {
            if (!this.instants) return false
            return true
            /*const startInstant= Math.max(Math.floor(this.playhead/this.instant_duration), 0)
            const endInstant= Math.min(Math.floor((this.playhead+duration)/this.instant_duration), this.instants.length-1)
            const endTime= this.playhead+duration
            for(let i=startInstant; i<=endInstant; i++){
                const instant= this.instants[i]
                const instant_start= i*this.instant_duration-this.playhead
                for(const {offset,note} of instant){
                    const start= (instant_start+offset)/1000
                    if(start<0 || start>endTime)continue
                    /* MULTI CHANNEL SUPPORT  : Unactivated because of burns instruments not supporting them
                    this.current_channel++
                    if(this.current_channel>=16)this.current_channel=0*/
            // TODO I add a negative offset to the note end because icannot use channel because some WAM don't work if I do.
            /*                    this.emitEvents(
                                    { type: 'wam-midi', time: currentTime+start, data: { bytes: new Uint8Array([0x90 | this.current_channel, note.note, note.velocity*100]) } },
                                    { type: 'wam-midi', time: currentTime+start+note.duration/1000-0.0001, data: { bytes: new Uint8Array([0x90 | this.current_channel, note.note, 0]) } },
                                    { type: 'wam-midi', time: currentTime+start+note.duration/1000-0.0001, data: { bytes: new Uint8Array([0x80 | this.current_channel, note.note, note.velocity*100]) } },
                                );
                            }
                        }
                        return false*/
        }

        _connectEvents(...args: any[]) {
            super._connectEvents(...args)
        }

    }

    console.log("moduleId", moduleId)
    try { registerProcessor(moduleId, MIDIPlayerProcessor) } catch (e) { }
}