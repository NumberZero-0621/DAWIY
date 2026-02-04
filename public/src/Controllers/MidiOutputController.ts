import { invoke } from "@tauri-apps/api/core";
import App from "../App";

export default class MidiOutputController {

    app: App;
    connectedPort: string | null = null;
    availablePorts: string[] = [];
    public static instance: MidiOutputController;

    constructor(app: App) {
        this.app = app;
        MidiOutputController.instance = this;
    }

    /**
     * 利用可能なMIDI出力ポートのリストを取得
     */
    async listOutputs(): Promise<string[]> {
        try {
            const ports = await invoke<string[]>("list_midi_outputs");
            this.availablePorts = ports;
            return ports;
        } catch (e) {
            console.error("[MIDI] Failed to list outputs:", e);
            return [];
        }
    }

    /**
     * MIDI出力ポートに接続
     */
    async connect(portName: string): Promise<boolean> {
        try {
            const result = await invoke<string>("open_midi_output", { portName });
            console.log("[MIDI]", result);
            this.connectedPort = portName;
            this.app.showToast(`Connected to MIDI Out: ${portName}`);
            return true;
        } catch (e) {
            console.error("[MIDI] Connection failed:", e);
            this.app.showToast(`MIDI Connection Failed: ${e}`, true);
            return false;
        }
    }

    /**
     * MIDI出力ポートを切断
     */
    async disconnect(): Promise<void> {
        if (!this.connectedPort) return;
        try {
            await invoke("close_midi_output");
            console.log("[MIDI] Disconnected");
            this.connectedPort = null;
        } catch (e) {
            console.error("[MIDI] Disconnection failed:", e);
        }
    }

    /**
     * MIDIメッセージを送信
     * @param bytes MIDIメッセージのバイト配列 (例: [0x90, 60, 100])
     */
    async send(bytes: number[]): Promise<void> {
        if (!this.connectedPort) return;
        console.log("[JS MIDI Send]", bytes);
        // invokeはオーバーヘッドがあるため、頻繁な呼び出しは注意が必要だが、
        // 現状のアーキテクチャではこれしか方法がない。
        try {
            // invokeはPromiseを返すが、発火して忘れる (fire-and-forget)
            invoke("send_midi_message", { message: bytes }).catch(e => {
                console.error("[MIDI] Send failed:", e);
            });
        } catch (e) {
            // ここには来ないはず
        }
    }
}
