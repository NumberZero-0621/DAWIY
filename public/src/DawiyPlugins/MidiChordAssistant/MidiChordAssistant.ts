import App from "../../App";
import { DAWIYPlugin } from "../IDawiyPlugin";
import DawiyPluginBase from "../DawiyPluginBase";

// コード検出のための定義
const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

// 共通のコードパターン。各要素はルートからの半音数。
const chordPatterns: { [key: string]: number[] } = {
    // Triads
    'Major': [0, 4, 7],
    'Minor': [0, 3, 7],
    'Augmented': [0, 4, 8],
    'Diminished': [0, 3, 6],

    // Sevenths
    'Major 7': [0, 4, 7, 11],
    'Minor 7': [0, 3, 7, 10],
    'Dominant 7': [0, 4, 7, 10],
    'Minor Major 7': [0, 3, 7, 11], // mM7
    'Half-Diminished': [0, 3, 6, 10], // m7b5
    'Diminished 7': [0, 3, 6, 9],
};

@DAWIYPlugin
export default class MidiChordAssistant extends DawiyPluginBase {
    id = "midi-chord-assistant";
    name = "MIDI Chord Assistant";
    description = "Detects and displays real-time MIDI chords.";
    author = "Your Name";
    version = "1.0.0";

    group = "AI Generated"; // grouping

    private activeNotes: Set<number> = new Set(); // 現在押されているMIDIノート番号
    private chordDisplayElement: HTMLElement | null = null; // コード名を表示するDOM要素

    constructor(app: App) {
        super(app);
    }

    /**
     * プラグインのUIをレンダリングします。
     * @param container UIを挿入するHTMLElement
     */
    render(container: HTMLElement): void {
        container.innerHTML = `
            <style>
                .midi-chord-assistant {
                    font-family: Arial, sans-serif;
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                    padding: 15px;
                    background-color: #2a2a2a;
                    border-radius: 8px;
                    color: #e0e0e0;
                    min-width: 200px;
                    min-height: 100px;
                    box-shadow: 0 4px 8px rgba(0, 0, 0, 0.3);
                }
                .midi-chord-assistant h3 {
                    margin-top: 0;
                    color: #bb86fc; /* DAWIY-like purple */
                }
                .chord-display {
                    font-size: 2.5em;
                    font-weight: bold;
                    margin-top: 10px;
                    color: #03dac6; /* DAWIY-like teal */
                }
                .no-chord {
                    font-size: 1.2em;
                    color: #888;
                }
            </style>
            <div class="midi-chord-assistant">
                <h3>MIDI Chord Assistant</h3>
                <div class="chord-display" id="chordDisplay">No Chord</div>
            </div>
        `;

        this.chordDisplayElement = container.querySelector('#chordDisplay');

        // MIDIイベントリスナーを設定
        // SettingsControllerのon_midi_message Setに追加
        this.app.settingsController.on_midi_message.add(this.handleMidiMessage);
    }

    /**
     * MIDIメッセージを処理します。
     * @param message MIDIメッセージイベント
     */
    // @ts-ignore
    private handleMidiMessage = (event: any): void => {
        // MIDIMessageEvent might not be in the global types, so we cast or use any.
        // In a perfect world we would define interface MIDIMessageEvent { data: Uint8Array; }
        const message = event.data as Uint8Array;
        if (!message) return;

        const status = message[0] & 0xF0; // ステータスバイト（チャンネルを除く）
        const note = message[1];
        // const velocity = message[2];

        // Note On (0x90)
        if (status === 0x90) {
            // Velocityが0の場合、Note Offとして扱うDAWもあるため確認
            if (message[2] > 0) {
                this.activeNotes.add(note);
            } else {
                this.activeNotes.delete(note);
            }
            this.updateChordDisplay();
        }
        // Note Off (0x80)
        else if (status === 0x80) {
            this.activeNotes.delete(note);
            this.updateChordDisplay();
        }
    };

    /**
     * 現在押されているノートに基づいてコードを検出し、表示を更新します。
     */
    private updateChordDisplay(): void {
        if (!this.chordDisplayElement) return;

        if (this.activeNotes.size < 3) { // コードを構成するには最低3つのノートが必要
            this.chordDisplayElement.textContent = "No Chord";
            this.chordDisplayElement.classList.add('no-chord');
            return;
        }

        const pitchClasses = Array.from(this.activeNotes)
            .map(note => note % 12)
            .sort((a, b) => a - b);

        let detectedChord: string | null = null;

        // 各ノートをルートとして試行
        for (const possibleRoot of pitchClasses) {
            const normalizedPattern = pitchClasses
                .map(pc => (pc - possibleRoot + 12) % 12)
                .sort((a, b) => a - b);

            // 重複を除去（オクターブ違いのノートは同じピッチクラスになるため）
            const uniqueNormalizedPattern = Array.from(new Set(normalizedPattern));

            for (const chordType in chordPatterns) {
                const pattern = chordPatterns[chordType];

                // パターンが完全に一致するかチェック
                // (ノート数が同じ & 全てのピッチクラスが一致)
                if (uniqueNormalizedPattern.length === pattern.length &&
                    uniqueNormalizedPattern.every((val, index) => val === pattern[index])) {

                    detectedChord = `${noteNames[possibleRoot]} ${chordType}`;
                    break;
                }
            }
            if (detectedChord) {
                break; // コードが見つかったら終了
            }
        }

        if (detectedChord) {
            this.chordDisplayElement.textContent = detectedChord;
            this.chordDisplayElement.classList.remove('no-chord');
        } else {
            this.chordDisplayElement.textContent = "Unknown Chord";
            this.chordDisplayElement.classList.add('no-chord');
        }
    }

    /**
     * プラグインが非アクティブになる/破棄される際にクリーンアップを行います。
     */
    override onDeactivate(): void {
        this.app.settingsController.on_midi_message.delete(this.handleMidiMessage);
        this.activeNotes.clear();
    }
}