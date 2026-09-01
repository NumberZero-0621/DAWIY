import App from "../../App";
import { DAWIYPlugin } from "../IDawiyPlugin";
import DawiyPluginBase from "../DawiyPluginBase";
import HostAPI from "../API/HostAPI";

@DAWIYPlugin
export default class TransposeModifierPlugin extends DawiyPluginBase {
    id = "transpose-modifier-plugin";
    name = "Transpose & Octave Tool";
    description = "選択中のトラックやリージョンのノートをオクターブ移動や転調させます。";
    group = "modifier";
    version = "1.0.0";

    constructor(app: App) {
        super(app);
    }

    public override render(container: HTMLElement) {
        container.innerHTML = "";
        container.style.padding = "15px";
        container.style.color = "#ecf0f1";
        container.style.background = "#2c3e50";
        container.style.borderRadius = "8px";

        const title = document.createElement("h4");
        title.textContent = "🎵 転調 & オクターブツール";
        title.style.marginBottom = "15px";
        container.appendChild(title);

        const desc = document.createElement("p");
        desc.textContent = "ピアノロールで選択中、もしくは現在選択されているリージョンのノートを一括操作します！";
        desc.style.fontSize = "12px";
        desc.style.color = "#bdc3c7";
        container.appendChild(desc);

        // ボタンコンテナ
        const btnContainer = document.createElement("div");
        btnContainer.style.display = "flex";
        btnContainer.style.flexDirection = "column";
        btnContainer.style.gap = "10px";
        btnContainer.style.marginTop = "15px";

        // オクターブ上
        const octUpBtn = document.createElement("button");
        octUpBtn.className = "btn btn-primary";
        octUpBtn.textContent = "オクターブ上げる (+12半音)";
        octUpBtn.onclick = () => this.shiftNotes(12);
        btnContainer.appendChild(octUpBtn);

        // オクターブ下
        const octDownBtn = document.createElement("button");
        octDownBtn.className = "btn btn-primary";
        octDownBtn.textContent = "オクターブ下げる (-12半音)";
        octDownBtn.onclick = () => this.shiftNotes(-12);
        btnContainer.appendChild(octDownBtn);

        // 半音プラス
        const semitoneUpBtn = document.createElement("button");
        semitoneUpBtn.className = "btn btn-secondary";
        semitoneUpBtn.textContent = "半音上げる (+1半音)";
        semitoneUpBtn.onclick = () => this.shiftNotes(1);
        btnContainer.appendChild(semitoneUpBtn);

        // 半音マイナス
        const semitoneDownBtn = document.createElement("button");
        semitoneDownBtn.className = "btn btn-secondary";
        semitoneDownBtn.textContent = "半音下げる (-1半音)";
        semitoneDownBtn.onclick = () => this.shiftNotes(-1);
        btnContainer.appendChild(semitoneDownBtn);

        container.appendChild(btnContainer);
    }

    private async shiftNotes(semitones: number) {
        const host = this.app.hostAPI;
        
        // 1. ピアノロールで選択中のノートがあればそれを優先
        const selectedNotes = host.project.getSelectedNotes();
        if (selectedNotes && selectedNotes.length > 0) {
            const updates = selectedNotes.map(item => ({
                region: item.region,
                note: item.note,
                pitch: Math.min(127, Math.max(0, item.note.note + semitones))
            }));
            await host.project.updateNotes(updates);
            host.ui.showToast(`選択された ${selectedNotes.length} 個のノートを ${semitones > 0 ? '+' : ''}${semitones} 半音シフトしました！`);
            return;
        }

        // 2. 選択中ノートがなければ選択リージョン全体を対象にする
        const region = host.project.getSelectedRegion();
        if (!region || !region.midi || !region.midi.notes) {
            host.ui.showToast("操作対象のノートやリージョンが選択されていません！", true);
            return;
        }

        const notes = region.midi.notes;
        if (notes.length === 0) {
            host.ui.showToast("選択されたリージョンにノートがありません。", true);
            return;
        }

        const updates = notes.map(item => ({
            region: region,
            note: item.note,
            pitch: Math.min(127, Math.max(0, item.note.note + semitones))
        }));

        await host.project.updateNotes(updates);
        host.ui.showToast(`リージョン内の全ノートを ${semitones} 半音シフトしました♪`);
    }
}

function idToString(n: number) {
    return n > 0 ? "+" + n : String(n);
}