export type Language = "en" | "ja";

const STORAGE_KEY = "wam_studio_lang";

export let CURRENT_LANGUAGE: Language = (localStorage.getItem(STORAGE_KEY) as Language) || "en";

const DICTIONARY: Record<Language, Record<string, string>> = {
    "en": {
        "loading": "Loading",
        "menu.select_demo": "Select Demo Project",
        "menu.load_project": "Load project",
        "menu.load_wam": "WAM-Studio",
        "menu.load_dawproject": "dawproject",
        "menu.save_project": "Save project",
        "menu.save_wam": "WAM-Studio",
        "menu.save_dawproject": "dawproject",
        "menu.export_project": "Render/Export project",
        "menu.export_audio": "Audio",
        "menu.export_midi": "MIDI",
        "menu.import": "Import",
        "menu.import_audio": "Audio file(s)",
        "menu.import_midi": "MIDI file",
        "menu.keyboard_shortcuts": "Keyboard shortcuts",
        "menu.calibrate_latency": "Calibrate latency compensation",
        "menu.settings": "Settings",
        "menu.dawiy_plugin": "DAWIY Plugin",
        "menu.login": "Login (Administrator)",
        "menu.logout": "Log out (Administrator)",
        "menu.playground": "Playground",
        "menu.about": "About",
        "tooltip.restart": "Restart",
        "tooltip.play": "Play",
        "tooltip.pause": "Pause",
        "tooltip.stop": "Stop",
        "tooltip.record": "Record",
        "tooltip.stop_recording": "Stop recording",
        "tooltip.loop": "Loop",
        "tooltip.turn_off_loop": "Turn off looping",
        "tooltip.tool_mode": "Tool Mode",
        "tooltip.metronome": "Metronome",
        "tooltip.metronome_on": "Metronome On",
        "tooltip.metronome_off": "Metronome Off",
        "tooltip.mute": "Mute",
        "tooltip.unmute": "Unmute",
        "tooltip.snap_grid": "Snap grid",
        "tooltip.snap_grid_on": "Snap Grid On",
        "tooltip.snap_grid_off": "Snap Grid Off",
        "tooltip.split": "Split region (S)",
        "tooltip.merge": "Merge region (M)",
        "tooltip.undo": "Undo",
        "tooltip.redo": "Redo",
        "tooltip.zoom_out": "Zoom out",
        "tooltip.zoom_in": "Zoom in",
        "header.tracks": "TRACKS",
        "header.new_track": "New track",
        "header.master_track": "MASTER TRACK",
        "header.plugins": "PLUGINS",
        "settings.title": "Settings",
        "settings.input_device": "Input Device",
        "settings.output_device": "Output Device",
        "settings.midi_device": "MIDI Device",
        "settings.language": "Language",
        "tool.select": "Select Mode",
        "tool.pen": "Pen Mode",
        "snap.bar": "1/1 (Bar)",
        "snap.half": "1/2 (Half)",
        "snap.quarter": "1/4 (Quarter)",
        "snap.eighth": "1/8 (Eighth)",
        "snap.sixteenth": "1/16 (Sixteenth)",
        "snap.thirtysecond": "1/32 (Thirty-second)",
        "snap.triplet": "Triplet Mode",
        "window.about": "About Wam Open Studio",
        "window.keyboard_shortcuts": "Keyboard shortcuts",
        "window.latency": "Latency Compensation",
        "window.calibrate": "Calibrate Latency",
        "window.playground": "Developper Playground",
        "window.advanced": "Advanced Window"
    },
    "ja": {
        "loading": "読み込み中",
        "menu.select_demo": "デモプロジェクトを選択",
        "menu.load_project": "プロジェクトを読み込む",
        "menu.load_wam": "WAM-Studio",
        "menu.load_dawproject": "dawproject",
        "menu.save_project": "プロジェクトを保存",
        "menu.save_wam": "WAM-Studio",
        "menu.save_dawproject": "dawproject",
        "menu.export_project": "プロジェクトをエクスポート",
        "menu.export_audio": "オーディオ",
        "menu.export_midi": "MIDI",
        "menu.import": "インポート",
        "menu.import_audio": "オーディオ",
        "menu.import_midi": "MIDI",
        "menu.keyboard_shortcuts": "キーボードショートカット",
        "menu.calibrate_latency": "レイテンシー補正を調整",
        "menu.settings": "設定",
        "menu.dawiy_plugin": "DAWIYプラグイン",
        "menu.login": "ログイン（管理者用）",
        "menu.logout": "ログアウト",
        "menu.playground": "プレイグラウンド",
        "menu.about": "このアプリについて",
        "tooltip.restart": "最初に戻る",
        "tooltip.play": "再生",
        "tooltip.pause": "一時停止",
        "tooltip.stop": "停止",
        "tooltip.record": "録音",
        "tooltip.stop_recording": "録音停止",
        "tooltip.loop": "ループ",
        "tooltip.turn_off_loop": "ループ解除",
        "tooltip.tool_mode": "ツールモード",
        "tooltip.metronome": "メトロノーム",
        "tooltip.metronome_on": "メトロノーム オン",
        "tooltip.metronome_off": "メトロノーム オフ",
        "tooltip.mute": "ミュート",
        "tooltip.unmute": "ミュート解除",
        "tooltip.snap_grid": "グリッドにスナップ",
        "tooltip.snap_grid_on": "スナップ オン",
        "tooltip.snap_grid_off": "スナップ オフ",
        "tooltip.split": "リージョンを分割 (S)",
        "tooltip.merge": "リージョンを結合 (M)",
        "tooltip.undo": "元に戻す",
        "tooltip.redo": "やり直す",
        "tooltip.zoom_out": "縮小",
        "tooltip.zoom_in": "拡大",
        "header.tracks": "トラック",
        "header.new_track": "新規トラック",
        "header.master_track": "マスタートラック",
        "header.plugins": "プラグイン",
        "settings.title": "設定",
        "settings.input_device": "入力デバイス",
        "settings.output_device": "出力デバイス",
        "settings.midi_device": "MIDIデバイス",
        "settings.language": "言語",
        "tool.select": "選択モード",
        "tool.pen": "ペンモード",
        "snap.bar": "1/1 (小節)",
        "snap.half": "1/2 (2分音符)",
        "snap.quarter": "1/4 (4分音符)",
        "snap.eighth": "1/8 (8分音符)",
        "snap.sixteenth": "1/16 (16分音符)",
        "snap.thirtysecond": "1/32 (32分音符)",
        "snap.triplet": "3連符モード",
        "window.about": "Wam Open Studioについて",
        "window.keyboard_shortcuts": "キーボードショートカット",
        "window.latency": "レイテンシー補正",
        "window.calibrate": "レイテンシー調整",
        "window.playground": "開発者用プレイグラウンド",
        "window.advanced": "詳細ウィンドウ"
    }
};

export function t(key: string): string {
    return DICTIONARY[CURRENT_LANGUAGE][key] || key;
}

export function setLanguage(lang: Language) {
    CURRENT_LANGUAGE = lang;
    localStorage.setItem(STORAGE_KEY, lang);
    updateDOM();
}

export function updateDOM() {
    const elements = document.querySelectorAll('[data-i18n]');
    elements.forEach(el => {
        const key = el.getAttribute('data-i18n');
        if (key) {
            if (el.tagName === 'INPUT' && el.hasAttribute('placeholder')) {
                (el as HTMLInputElement).placeholder = t(key);
            } else {
                let textNodeFound = false;
                el.childNodes.forEach(node => {
                    if (node.nodeType === Node.TEXT_NODE && node.textContent?.trim().length! > 0) {
                        node.textContent = t(key);
                        textNodeFound = true;
                    }
                });

                if (!textNodeFound && el.children.length === 0) {
                    el.textContent = t(key);
                }
            }
        }
    });
}

// 初期実行
if (typeof document !== 'undefined') {
    updateDOM();
}