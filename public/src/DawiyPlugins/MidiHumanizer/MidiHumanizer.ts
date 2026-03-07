import App from "../../App";
import { DAWIYPlugin } from "../IDawiyPlugin";
import DawiyPluginBase from "../DawiyPluginBase";
import HostAPI from "../API/HostAPI";
import Track from "../../Models/Track/Track";
import MIDIRegion from "../../Models/Region/MIDIRegion";
import { MIDI, MIDINote } from "../../Audio/MIDI/MIDI";

@DAWIYPlugin
export default class MidiHumanizer extends DawiyPluginBase {
    id = "midi-humanizer";
    name = "MIDI Humanizer";
    description = "選択されたトラックのMIDIノートにランダムなタイミングとベロシティのばらつきを与えます。";
    author = "AI Assistant";
    version = "1.0.0";

    // UI elements
    private sidebarDiv: HTMLElement | null = null;
    private selectedTrackNameElement: HTMLElement | null = null;
    private timingShiftSlider: HTMLInputElement | null = null;
    private timingShiftNumberInput: HTMLInputElement | null = null;
    private velocityShiftSlider: HTMLInputElement | null = null;
    private velocityShiftNumberInput: HTMLInputElement | null = null;
    private humanizeButton: HTMLButtonElement | null = null;

    // Default values and current settings
    private currentTimingShiftMs: number = 10; // milliseconds
    private currentVelocityShift: number = 10; // 0-127 range

    constructor(app: App) {
        super(app);
    }

    public override onInit(host: HostAPI) {
        this.sidebarDiv = document.createElement("div");
        this.sidebarDiv.className = "p-3"; // Bootstrap padding

        this.sidebarDiv.innerHTML = `
            <h4 class="mb-3">MIDI Humanizer</h4>
            <p>
                <strong>選択中のトラック: </strong>
                <span id="${this.id}-selected-track-name">なし</span>
            </p>

            <div class="mb-3">
                <label for="${this.id}-timing-shift" class="form-label">タイミングシフト (±ms)</label>
                <input type="range" class="form-range" id="${this.id}-timing-shift-slider" min="0" max="50" value="${this.currentTimingShiftMs}">
                <input type="number" class="form-control mt-2" id="${this.id}-timing-shift-number" min="0" max="100" value="${this.currentTimingShiftMs}">
                <div class="form-text">ノートの開始位置を最大 ±${this.currentTimingShiftMs}ms ランダムにずらします。</div>
            </div>

            <div class="mb-3">
                <label for="${this.id}-velocity-shift" class="form-label">ベロシティシフト (±)</label>
                <input type="range" class="form-range" id="${this.id}-velocity-shift-slider" min="0" max="60" value="${this.currentVelocityShift}">
                <input type="number" class="form-control mt-2" id="${this.id}-velocity-shift-number" min="0" max="127" value="${this.currentVelocityShift}">
                <div class="form-text">ノートのベロシティを最大 ±${this.currentVelocityShift} ランダムにずらします。</div>
            </div>

            <button id="${this.id}-humanize-button" class="btn btn-primary w-100 mt-3">ヒューマナイズ！</button>
            <p class="text-danger mt-3">この操作は元に戻せません。実行前にプロジェクトを保存することをお勧めします。</p>
        `;

        this.selectedTrackNameElement = this.sidebarDiv.querySelector(`#${this.id}-selected-track-name`);
        this.timingShiftSlider = this.sidebarDiv.querySelector(`#${this.id}-timing-shift-slider`);
        this.timingShiftNumberInput = this.sidebarDiv.querySelector(`#${this.id}-timing-shift-number`);
        this.velocityShiftSlider = this.sidebarDiv.querySelector(`#${this.id}-velocity-shift-slider`);
        this.velocityShiftNumberInput = this.sidebarDiv.querySelector(`#${this.id}-velocity-shift-number`);
        this.humanizeButton = this.sidebarDiv.querySelector(`#${this.id}-humanize-button`);

        // Sync slider and number input for timing shift
        this.timingShiftSlider?.addEventListener("input", (e) => {
            const value = parseInt((e.target as HTMLInputElement).value);
            if (!isNaN(value)) {
                this.currentTimingShiftMs = value;
                if (this.timingShiftNumberInput) this.timingShiftNumberInput.value = String(value);
                if (this.timingShiftSlider) this.updateFormText(this.timingShiftSlider, value, "ms");
            }
        });
        this.timingShiftNumberInput?.addEventListener("input", (e) => {
            const value = parseInt((e.target as HTMLInputElement).value);
            if (!isNaN(value)) {
                this.currentTimingShiftMs = value;
                if (this.timingShiftSlider) this.timingShiftSlider.value = String(value);
                if (this.timingShiftNumberInput) this.updateFormText(this.timingShiftNumberInput, value, "ms");
            }
        });

        // Sync slider and number input for velocity shift
        this.velocityShiftSlider?.addEventListener("input", (e) => {
            const value = parseInt((e.target as HTMLInputElement).value);
            if (!isNaN(value)) {
                this.currentVelocityShift = value;
                if (this.velocityShiftNumberInput) this.velocityShiftNumberInput.value = String(value);
                if (this.velocityShiftSlider) this.updateFormText(this.velocityShiftSlider, value, "");
            }
        });
        this.velocityShiftNumberInput?.addEventListener("input", (e) => {
            const value = parseInt((e.target as HTMLInputElement).value);
            if (!isNaN(value)) {
                this.currentVelocityShift = value;
                if (this.velocityShiftSlider) this.velocityShiftSlider.value = String(value);
                if (this.velocityShiftNumberInput) this.updateFormText(this.velocityShiftNumberInput, value, "");
            }
        });

        this.humanizeButton?.addEventListener("click", () => this.humanizeSelectedTrackMidi(host));

        host.ui.registerSidebarItem(this.id, "bi-magic", this.name, this.sidebarDiv);
    }

    private updateFormText(element: HTMLInputElement, value: number, unit: string) {
        const parentDiv = element.closest('.mb-3');
        if (parentDiv) {
            const formText = parentDiv.querySelector('.form-text');
            if (formText) {
                if (element === this.timingShiftSlider || element === this.timingShiftNumberInput) {
                    formText.textContent = `ノートの開始位置を最大 ±${value}${unit} ランダムにずらします。`;
                } else if (element === this.velocityShiftSlider || element === this.velocityShiftNumberInput) {
                    formText.textContent = `ノートのベロシティを最大 ±${value} ランダムにずらします。`;
                }
            }
        }
    }


    public override onActivate() {
        // Update selected track name when plugin sidebar is activated
        this.updateSelectedTrackDisplayName();
    }

    public override onDeactivate() {
        // Cleanup if necessary, though for this plugin, event listeners are attached to static elements
    }

    private updateSelectedTrackDisplayName() {
        if (this.selectedTrackNameElement) {
            const selectedTrack = this.app.tracksController.selectedTrack;
            this.selectedTrackNameElement.textContent = selectedTrack ? selectedTrack.element.name : "なし";
        }
    }

    private async humanizeSelectedTrackMidi(host: HostAPI) {
        const selectedTrack = this.app.tracksController.selectedTrack;

        if (!selectedTrack) {
            host.ui.showToast("ヒューマナイズするトラックが選択されていません。", true);
            return;
        }

        this.updateSelectedTrackDisplayName(); // Ensure displayed track name is current

        const regions = selectedTrack.regions.filter(
            (r): r is MIDIRegion => r instanceof MIDIRegion
        );

        if (regions.length === 0) {
            host.ui.showToast(`'${selectedTrack.element.name}' トラックにMIDIリージョンが見つかりませんでした。`, false);
            return;
        }

        host.ui.showToast(`'${selectedTrack.element.name}' のMIDIをヒューマナイズしています...`, false);

        for (const region of regions) {
            const originalMidi = region.midi;
            if (!originalMidi) continue;

            const newNotesData: { note: MIDINote, start: number }[] = originalMidi.notes.map(noteData => {
                const oldNote = noteData.note;
                // MIDINote はイミュータブルな設計のため、新しいインスタンスを作成する
                const newNote = new MIDINote(oldNote.note, oldNote.velocity, oldNote.channel, oldNote.duration);
                let newStart = noteData.start;

                // タイミングシフト
                const timingShift = (Math.random() * 2 * this.currentTimingShiftMs) - this.currentTimingShiftMs;
                newStart = Math.max(0, newStart + timingShift); // 開始時刻が負にならないように0でクランプ

                // ベロシティシフト
                const velocityShift = (Math.random() * 2 * this.currentVelocityShift) - this.currentVelocityShift;
                newNote.velocity = Math.max(0, Math.min(127, newNote.velocity + velocityShift)); // ベロシティを0-127でクランプ

                return { note: newNote, start: newStart };
            });

            // 変更されたノートデータから新しいMIDIオブジェクトを作成
            // リージョンの全体の長さを維持するため、元のMIDIのdurationをtotalDurationとして渡す
            const newMidi = MIDI.fromNotes(newNotesData, originalMidi.instant_duration, originalMidi.duration);
            region.midi = newMidi; // リージョンに新しいMIDIデータを割り当てる
        }

        host.ui.showToast(`'${selectedTrack.element.name}' のMIDIヒューマナイズが完了しました！`, false);
    }

    public override render(container: HTMLElement) {
        // このプラグインは主にサイドバーUIを使用するため、メインビューには特別なコンテンツはありません。
        container.innerHTML = "<h3>MIDI Humanizer Plugin</h3><p>サイドバーから操作してください。</p>";
    }
}