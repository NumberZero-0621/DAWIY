import App from "../App";
import { CurveMode } from "../Models/Region/AutomationRegion";
import { t } from "../Utils/i18n";
import ContextMenuView from "../Views/ContextMenuView";

export default class ContextMenuController {

    private _app: App;
    private _view: ContextMenuView;

    constructor(app: App) {
        this._app = app;
        this._view = new ContextMenuView();
        this._view.setCallback((action) => this.handleAction(action));

        this.bindEvents();
    }

    public hide() {
        this._view.hide();
    }

    private bindEvents() {
        window.addEventListener("contextmenu", (e) => {
            // Check if Shift is held. If so, let browser handle it.
            if (e.shiftKey) return;

            // Check if hamburger menu is open
            const hamburgerMenuBtn = document.getElementById("dropdownMenuButton");
            if (hamburgerMenuBtn && hamburgerMenuBtn.getAttribute("aria-expanded") === "true") {
                e.preventDefault();
                return;
            }

            e.preventDefault();

            // Check where the click happened to customize menu if needed
            this.showMenu(e.clientX, e.clientY);
        });

        window.addEventListener("click", () => {
            if (this._view.isVisible()) {
                this._view.hide();
            }
        });

        // Also hide on scroll or resize?
        window.addEventListener("scroll", () => this.hide(), true);
    }

    private lastMenuPosition: { x: number, y: number } | null = null;

    private showMenu(x: number, y: number) {
        this.lastMenuPosition = { x, y };
        const isPianoRoll = this._app.pianoRollController.isVisible;
        const currentRegionController = this._app.regionsController;
        const currentPianoRollController = this._app.pianoRollController;

        // オートメーション線部分のクリックをチェック
        const automationContext = currentRegionController.getAutomationContextAtPosition(x, y);
        this._automationContext = automationContext; // コンテキストを保存

        const hasSelection = isPianoRoll ? currentPianoRollController.hasSelection() : currentRegionController.hasSelection();
        const hasClipboard = isPianoRoll ? currentPianoRollController.hasClipboard() : currentRegionController.hasClipboard();
        const hasUndo = this._app.undoManager.hasUndo();
        const hasRedo = this._app.undoManager.hasRedo();

        const items: { label: string, action: string, separator?: boolean, disabled?: boolean }[] = [
            { label: t("context.undo"), action: "undo", disabled: !hasUndo },
            { label: t("context.redo"), action: "redo", disabled: !hasRedo },
            { label: "", action: "", separator: true },
            { label: t("context.cut"), action: "cut", disabled: !hasSelection },
            { label: t("context.copy"), action: "copy", disabled: !hasSelection },
            { label: t("context.paste"), action: "paste", disabled: !hasClipboard },
            { label: t("context.delete"), action: "delete", disabled: !hasSelection },
            { label: "", action: "", separator: true },
            { label: t("context.split"), action: "split", disabled: isPianoRoll || !hasSelection },
            { label: t("context.merge"), action: "merge", disabled: isPianoRoll || !hasSelection },
            { label: "", action: "", separator: true },
            { label: t("context.select_all"), action: "selectAll" },
        ];

        // オートメーション線上なら、カーブモード項目を追加
        if (automationContext) {
            const currentCurve = automationContext.region.points[automationContext.segmentIndex]?.curve ?? CurveMode.Linear;
            items.push({ label: "", action: "", separator: true });
            items.push({ label: t("context.curve_mode"), action: "", disabled: true });
            items.push({ label: (currentCurve === CurveMode.Linear ? "✓ " : "　") + t("context.curve_linear"), action: "curve_linear" });
            items.push({ label: (currentCurve === CurveMode.Step ? "✓ " : "　") + t("context.curve_step"), action: "curve_step" });
            items.push({ label: (currentCurve === CurveMode.Fast ? "✓ " : "　") + t("context.curve_fast"), action: "curve_fast" });
            items.push({ label: (currentCurve === CurveMode.Slow ? "✓ " : "　") + t("context.curve_slow"), action: "curve_slow" });
            items.push({ label: "", action: "", separator: true });
            items.push({ label: t("context.clear_envelope"), action: "clear_envelope" });
        }

        items.push({ label: "", action: "", separator: true });
        items.push({ label: t("context.browser_menu_hint"), action: "browser_menu_hint", disabled: true });

        this._view.show(x, y, items);
    }

    private _automationContext: { segmentIndex: number, region: any, track: any } | null = null;

    private handleAction(action: string) {
        const isPianoRoll = this._app.pianoRollController.isVisible;

        // オートメーションカーブモード関連のアクション
        if (action.startsWith("curve_") && this._automationContext) {
            const { segmentIndex, region, track } = this._automationContext;

            let newCurve: CurveMode;
            switch (action) {
                case "curve_linear": newCurve = CurveMode.Linear; break;
                case "curve_step": newCurve = CurveMode.Step; break;
                case "curve_fast": newCurve = CurveMode.Fast; break;
                case "curve_slow": newCurve = CurveMode.Slow; break;
                default: return;
            }

            // 選択されているオートメーションポイントを取得
            const selectedPoints = this._app.regionsController.selectedAutomationPoints.get(region);

            if (selectedPoints && selectedPoints.size >= 2) {
                // 複数ポイントが選択されている場合、選択ポイント間すべてにカーブモードを適用
                const sortedIndices = Array.from(selectedPoints).sort((a, b) => a - b);
                const minIndex = sortedIndices[0];
                const maxIndex = sortedIndices[sortedIndices.length - 1];

                // minIndex から maxIndex-1 までの各ポイントのカーブモードを変更
                for (let i = minIndex; i < maxIndex; i++) {
                    if (region.points[i]) {
                        region.points[i].curve = newCurve;
                    }
                }
            } else {
                // 単一セグメントの変更（右クリックした線のみ）
                const point = region.points[segmentIndex];
                if (point) {
                    point.curve = newCurve;
                }
            }

            // データ更新
            if (region.paramId) {
                track.automationData.set(region.paramId, region.points);
            }
            // 再描画
            const view = this._app.regionsController.getView(region);
            view?.redraw("", region);
            // 再生中ならストリーミングリセット
            if (this._app.host.isPlaying) {
                this._app.automationController.resetAutomationStreaming();
            }

            this._automationContext = null;
            return;
        }

        // エンベロープクリア
        if (action === "clear_envelope" && this._automationContext) {
            const { region, track } = this._automationContext;
            const originalPoints = JSON.parse(JSON.stringify(region.points));

            // デフォルトポイント（開始と終了）にリセット
            region.points = [
                { time: 0, value: 0.5, curve: CurveMode.Linear },
                { time: region.duration, value: 0.5, curve: CurveMode.Linear }
            ];
            if (region.paramId) {
                track.automationData.set(region.paramId, region.points);
            }
            // 再描画
            const view = this._app.regionsController.getView(region);
            view?.redraw("", region);
            // Undo登録
            this._app.addRedoUndo(
                () => { /* already done */ },
                () => {
                    region.points = originalPoints;
                    if (region.paramId) track.automationData.set(region.paramId, originalPoints);
                    view?.redraw("", region);
                }
            );
            this._automationContext = null;
            return;
        }

        switch (action) {
            case "undo":
                this._app.undoManager.undo();
                break;
            case "redo":
                this._app.undoManager.redo();
                break;
            case "cut":
                if (isPianoRoll) this._app.pianoRollController.cutSelectedNotes();
                else this._app.regionsController.cutSelectedRegion();
                break;
            case "copy":
                if (isPianoRoll) this._app.pianoRollController.copySelectedNotes();
                else this._app.regionsController.copySelectedRegion();
                break;
            case "paste":
                if (isPianoRoll) this._app.pianoRollController.pasteNotes();
                else this._app.regionsController.pasteRegion(true, this.lastMenuPosition?.x);
                break;
            case "delete":
                if (isPianoRoll) this._app.pianoRollController.deleteSelectedNotes();
                else this._app.regionsController.deleteSelectedRegion(true);
                break;
            case "split":
                if (!isPianoRoll) this._app.regionsController.splitSelectedRegion();
                break;
            case "merge":
                if (!isPianoRoll) this._app.regionsController.mergeSelectedRegion();
                break;
            case "selectAll":
                if (isPianoRoll) this._app.pianoRollController.selectAllNotes();
                else this._app.regionsController.selectAllRegions();
                break;
        }
    }
}
