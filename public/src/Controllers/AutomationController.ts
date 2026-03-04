import App from "../App";
import AutomationTrackElement from "../Components/Editor/AutomationTrackElement";
import { MAX_DURATION_SEC } from "../Env";
import AutomationRegion, { CurveMode, AutomationPoint } from "../Models/Region/AutomationRegion";
import Track from "../Models/Track/Track";
import AutomationView from "../Views/AutomationView";
import ColorPickerView from "../Views/ColorPickerView";


export default class AutomationController {

    private _app: App;
    private _view: AutomationView;
    private _colorPicker: ColorPickerView;

    public static readonly PARAM_VOLUME = "__dawiy_volume__";
    public static readonly PARAM_PAN = "__dawiy_pan__";
    public static readonly RAMP_GRANULARITY = 0.25; // 250msに増加（パフォーマンス改善）

    // ストリーミング用の状態管理
    private static readonly LOOK_AHEAD_MS = 2000;  // 2秒先までスケジュール
    private static readonly UPDATE_INTERVAL_MS = 500; // 500ms毎に更新
    private _streamingInterval: number | null = null;
    private _lastScheduledPlayhead: number = 0; // 最後にスケジュールした再生位置(ms)
    private _isStreaming: boolean = false;

    constructor(app: App) {
        this._app = app;
        this._view = this._app.automationView;
        this._colorPicker = new ColorPickerView();
    }

    /**
     * Toggles automation visibility.
     * If visible, adds AutomationTrackElement and populates dropdown.
     */
    public async toggleAutomationVisibility(track: Track, visible: boolean) {
        if (track.isAutomationOpened === visible && track.automationRegions.length > 0) return;

        track.isAutomationOpened = visible;

        if (visible) {
            // 表示: 前回の状態があれば復元
            if (track.lastAutomationParams && track.lastAutomationParams.length > 0) {
                for (const paramId of track.lastAutomationParams) {
                    await this.addAutomationLane(track, paramId);
                }
            } else if (track.automationRegions.length === 0) {
                // 初回あるいは前回情報がない場合はデフォルト（1つ追加）
                await this.addAutomationLane(track);
            }
        } else {
            // 非表示: 状態を保存してから削除
            track.lastAutomationParams = track.automationRegions.map(r => r.paramId);

            // コピーを作成して反復中に配列を変更しないようにする
            const regionsToRemove = [...track.automationRegions];
            regionsToRemove.forEach(region => {
                this.removeSpecificAutomationLane(track, region);
            });
            track.automationRegions = [];
        }
        this._app.editorView.resizeCanvas();
    }

    /**
     * 新しいオートメーションレーンを追加する
     */
    public async addAutomationLane(track: Track, preferredParamId?: string): Promise<void> {
        // 1. パラメータ情報の取得
        const paramList = await this.getAvailableParameters(track);

        // 2. 次に使用するパラメータを決定
        let nextParamId: string | null = preferredParamId || null;
        if (!nextParamId) {
            nextParamId = this.getNextParamId(track, paramList);
        }

        if (!nextParamId) {
            console.warn("No more parameters available for automation");
            return;
        }

        // 3. AutomationRegionの作成
        // 既存のデータがあればそれを使用、なければ新規作成
        let points = track.automationData.get(nextParamId);
        if (!points) {
            // 初期ポイント作成
            // デフォルト値取得ロジックは setupLane に集約するか、ここでやるか
            // とりあえずここで空で作って、setupLaneで初期化する
            points = [];
        }

        const region = new AutomationRegion(0, MAX_DURATION_SEC * 1000);
        region.paramId = nextParamId;
        region.points = points; // 空の場合は後で初期値が入る、または既存データが入る

        // 4. トラックへの追加
        track.automationRegions.push(region);

        // 色復元
        const savedColor = track.automationColors.get(nextParamId);
        if (savedColor) {
            region.color = savedColor;
        } else {
            region.color = track.color;
        }

        // ポイントがない場合の初期化（初期値取得など）
        if (region.points.length === 0) {
            await this.initializeRegionPoints(track, region);
        }

        this._app.regionsController.addRegion(track, region);

        // 5. AutomationTrackElement (UI) の作成と追加
        this.createAutomationTrackElement(track, region, paramList);

        // 追加ボタンの状態更新（全てのレーンに対してチェック）
        await this.updateAllAutomationLanes(track);
    }

    /**
     * 特定のオートメーションレーンを削除する
     */
    public removeSpecificAutomationLane(track: Track, region: AutomationRegion): void {
        // 1. データのバックアップ
        if (region.paramId) {
            track.automationData.set(region.paramId, region.points);
        }

        // 2. Region削除
        this._app.regionsController.removeRegion(region);
        track.automationRegions = track.automationRegions.filter(r => r !== region);

        // 3. UI削除
        const elId = "automation-track-" + region.id;
        const el = document.getElementById(elId) as AutomationTrackElement;
        if (el) {
            this._app.tracksView.removeAutomationTrack(el);
        }

        // 追加ボタンの状態更新
        // (非同期でパラメータ取得して更新する必要があるが、削除時は少し遅れても良い)
        // ここでは呼ばないか、必要なら呼ぶ。削除後の再評価は非同期で行う。
        this.updateAllAutomationLanes(track);

        if (track.automationRegions.length === 0) {
            track.isAutomationOpened = false;
        }
    }

    private async createAutomationTrackElement(track: Track, region: AutomationRegion, paramList: { id: string, label: string }[]) {
        let automationTrackElement = document.createElement("automation-track-element") as AutomationTrackElement;
        automationTrackElement.id = "automation-track-" + region.id;

        // 既存のAutomationTrackElementの後ろに追加したいが、TracksView.addAutomationTrackは
        // 「トラック要素の後ろ」に追加する仕様。
        // 複数ある場合は、最後のAutomationTrackElementの後ろに追加する必要がある。
        // Helper function in View to insert at correct position?
        // 現在のTracksView.addAutomationTrack実装: trackElement.after(el).
        // 逆順に追加していけば...いや、順番通りに追加したい。
        // 既存のオートメーション要素の最後を探す。
        const lastRegion = track.automationRegions[track.automationRegions.length - 2]; // 1つ前
        if (lastRegion) {
            const lastEl = document.getElementById("automation-track-" + lastRegion.id);
            if (lastEl) {
                lastEl.after(automationTrackElement);
            } else {
                this._app.tracksView.addAutomationTrack(track.element, automationTrackElement);
            }
        } else {
            this._app.tracksView.addAutomationTrack(track.element, automationTrackElement);
        }

        automationTrackElement.setParameters(paramList, region.paramId);

        // イベントリスナー設定
        automationTrackElement.onChange = async (newParamId) => {
            await this.handleParamChange(track, region, newParamId);

            const newColor = region.color || track.color;
            automationTrackElement.setColor(newColor);

            await this.updateAllAutomationLanes(track);
            this._app.editorView.resizeCanvas();
        };

        automationTrackElement.onAdd = async () => {
            await this.addAutomationLane(track);
            this._app.editorView.resizeCanvas();
        };

        automationTrackElement.onRemove = () => {
            this.removeSpecificAutomationLane(track, region);
            this._app.editorView.resizeCanvas();
        };

        // 初期色セット
        automationTrackElement.setColor(region.color || track.color);

        automationTrackElement.onColorClick = (x, y) => {
            const initialColor = region.color || track.color;
            this._colorPicker.show(x, y, initialColor, async (newColor) => {
                region.color = newColor;
                track.automationColors.set(region.paramId, newColor);
                automationTrackElement.setColor(newColor);

                const regionView = this._app.editorView.getWaveFormViewById(track.id)?.getRegionViewById(region.id);
                if (regionView) {
                    regionView.redraw(newColor, region);
                }
            });
        };
    }

    private async handleParamChange(track: Track, region: AutomationRegion, newParamId: string) {
        const oldParamId = region.paramId;
        if (oldParamId) {
            track.automationData.set(oldParamId, region.points);
        }

        let newPoints = track.automationData.get(newParamId);
        if (!newPoints || newPoints.length === 0) {
            region.paramId = newParamId; // 一時設定
            await this.initializeRegionPoints(track, region); // 初期値取得
            region.points = region.points; // リロード
        } else {
            region.paramId = newParamId;
            region.points = newPoints;
        }

        // 色同期
        const savedColor = track.automationColors.get(newParamId);
        if (savedColor) {
            region.color = savedColor;
        } else {
            region.color = track.color; // 新規パラメータの時はトラックカラーを初期値に
        }

        // Redraw
        const regionView = this._app.editorView.getWaveFormViewById(track.id)?.getRegionViewById(region.id);
        if (regionView) {
            regionView.redraw(region.color, region);
        }
    }

    private async initializeRegionPoints(track: Track, region: AutomationRegion) {
        const paramId = region.paramId;
        let initialVal = 0.5;
        const plugin = track.plugins.length > 0 ? track.plugins[0] : null;

        if (plugin?.instance) {
            const values = await plugin.instance._audioNode.getParameterValues(false, paramId);
            const info = await plugin.instance._audioNode.getParameterInfo(paramId);

            if (values && values[paramId] && info && info[paramId]) {
                const rawVal = values[paramId].value;
                const min = info[paramId].minValue ?? 0;
                const max = info[paramId].maxValue ?? 1;
                const range = max - min;
                if (range !== 0) {
                    initialVal = (rawVal - min) / range;
                    initialVal = Math.max(0, Math.min(1, initialVal));
                }
            }
        }

        // 既存の配列をクリアして設定
        region.points = [
            { time: 0, value: initialVal, curve: CurveMode.Linear },
            { time: region.duration, value: initialVal, curve: CurveMode.Linear }
        ];

        // データストアにも保存
        track.automationData.set(paramId, region.points);
    }

    /**
     * プラグインのパラメータ変更に伴い、オートメーションの状態を同期する
     */
    public async syncAutomationParams(track: Track) {
        if (track.plugins.length === 0 || !track.plugins[0].instance) return;

        // 現在のプラグインパラメータを取得
        let params: any = {};
        try {
            params = await track.plugins[0].instance._audioNode.getParameterInfo();
        } catch (e) {
            console.error("Failed to get parameter info", e);
            return;
        }

        const availableParamIds = new Set(Object.keys(params));
        // Volume/Panは常に有効
        availableParamIds.add(AutomationController.PARAM_VOLUME);
        availableParamIds.add(AutomationController.PARAM_PAN);

        let changed = false;

        // 1. 無効になったパラメータのデータを削除
        const paramsToRemove: string[] = [];
        for (const paramId of track.automationData.keys()) {
            if (!availableParamIds.has(paramId)) {
                paramsToRemove.push(paramId);
            }
        }

        for (const paramId of paramsToRemove) {
            track.automationData.delete(paramId);
            track.automationColors.delete(paramId);
            changed = true;
        }

        // 2. 無効になったパラメータのオートメーションレーンを削除
        // コピーを作成してループ
        const regionsToCheck = [...track.automationRegions];
        for (const region of regionsToCheck) {
            if (!availableParamIds.has(region.paramId)) {
                this.removeSpecificAutomationLane(track, region);
                changed = true;
            }
        }

        // 3. 残っているレーンのプルダウン更新
        await this.updateAllAutomationLanes(track);

        if (changed) {
            this._app.editorView.resizeCanvas();
        }
    }

    private async getAvailableParameters(track: Track): Promise<{ id: string, label: string }[]> {
        let paramList: { id: string, label: string }[] = [];
        paramList.push({ id: AutomationController.PARAM_VOLUME, label: "Volume" });
        paramList.push({ id: AutomationController.PARAM_PAN, label: "Pan" });

        if (track.plugins.length > 0 && track.plugins[0].instance) {
            let params = await track.plugins[0].instance._audioNode.getParameterInfo();
            for (let paramId in params) {
                paramList.push({
                    id: paramId,
                    label: params[paramId].label || paramId
                });
            }
        }
        return paramList;
    }

    private getNextParamId(track: Track, paramList: { id: string, label: string }[]): string | null {
        // 現在表示中のID
        const currentIds = new Set(track.automationRegions.map(r => r.paramId));

        // 候補（表示中でないもの）
        const candidates = paramList.filter(p => !currentIds.has(p.id));

        if (candidates.length === 0) return null;

        // 優先度1: データがあるもの (Length > 2 or has curve or diff values - 簡易的にデータがあるもの全部)
        // track.automationData にエントリがあるものを優先
        const withData = candidates.filter(p => {
            const points = track.automationData.get(p.id);
            // 初期状態(2点かつ値が同じ)でない、という判定を入れるとより良いが、
            // ここでは「データエントリが存在する」ものを優先とする
            return points && points.length > 0;
        });

        if (withData.length > 0) return withData[0].id;

        // 優先度2: 未編集（リスト順）
        return candidates[0].id;
    }

    private async updateAllAutomationLanes(track: Track) {
        const allParams = await this.getAvailableParameters(track);
        const hasMore = allParams.length > track.automationRegions.length;

        track.automationRegions.forEach(region => {
            const el = document.getElementById("automation-track-" + region.id) as AutomationTrackElement;
            if (el) {
                const usedParams = new Set(
                    track.automationRegions
                        .filter(r => r.id !== region.id)
                        .map(r => r.paramId)
                );

                const filteredParams = allParams.filter(p => !usedParams.has(p.id));

                el.setParameters(filteredParams, region.paramId);
                el.setAddButtonEnabled(hasMore);
            }
        });
    }

    /**
     * Updates the color of automation lanes that are using the default track color.
     */
    public updateAutomationLaneColors(track: Track): void {
        track.automationRegions.forEach(region => {
            if (!region.color) {
                const el = document.getElementById("automation-track-" + region.id) as AutomationTrackElement;
                if (el) {
                    el.setColor(track.color);
                }
            }
        });
    }

    /**
     * Removes the automation track element (and region) from the view.
     * To be called when a track is deleted.
     */
    /**
     * Removes the automation track element (and region) from the view.
     * To be called when a track is deleted.
     */
    public removeAutomationLane(track: Track): void {
        const regionsToRemove = [...track.automationRegions];
        regionsToRemove.forEach(region => {
            this.removeSpecificAutomationLane(track, region);
        });
        track.isAutomationOpened = false;
        track.automationRegions = []; // Should already be empty, but ensure it.
    }

    // Compatibility methods (can be empty or removed if not used)
    public async openAutomationMenu(track: Track): Promise<void> {
        // Now just toggles visibility
        this.toggleAutomationVisibility(track, !track.isAutomationOpened);
    }

    public async updateAutomations(track: Track): Promise<void> {
        // No-op, handled in toggleAutomationVisibility
    }

    /**
     * Applies all automation points to the plugins.
     * Should be called on play or seek.
     * Now uses streaming mode for better performance.
     */
    public applyAllAutomations(): void {
        this.startAutomationStreaming();
    }

    /**
     * ストリーミング方式でオートメーションを開始
     */
    public startAutomationStreaming(): void {
        // 既にストリーミング中なら一度停止
        if (this._isStreaming) {
            this.stopAutomationStreaming();
        }

        this._isStreaming = true;
        this._lastScheduledPlayhead = this._app.host.playhead;

        // 初回は即座にスケジュール
        this.updateAutomationStream();

        // 定期的に更新
        this._streamingInterval = window.setInterval(() => {
            if (this._app.host.isPlaying) {
                this.updateAutomationStream();
            }
        }, AutomationController.UPDATE_INTERVAL_MS);
    }

    /**
     * ストリーミングを停止
     */
    public stopAutomationStreaming(): void {
        if (this._streamingInterval !== null) {
            clearInterval(this._streamingInterval);
            this._streamingInterval = null;
        }
        this._isStreaming = false;
        this._lastScheduledPlayhead = 0;
    }

    /**
     * ストリーミングをリセット（シークやポイント変更時）
     */
    public resetAutomationStreaming(): void {
        if (!this._isStreaming) return;

        // 全ノードのイベントをクリア
        const tracks = this._app.tracksController.tracks;
        for (const track of tracks) {
            if (track.plugins.length > 0 && track.plugins[0].instance?._audioNode) {
                track.plugins[0].instance._audioNode.clearEvents();
            }
            // AudioParamのスケジュールもキャンセル
            const currentTime = this._app.host.audioContext.currentTime;
            track.gainParameter?.cancelScheduledValues(currentTime);
            track.panParameter?.cancelScheduledValues(currentTime);
        }

        // 状態をリセットして再スケジュール
        this._lastScheduledPlayhead = this._app.host.playhead;
        this.updateAutomationStream();
    }

    /**
     * 現在位置から LOOK_AHEAD_MS 先までのイベントをスケジュール
     */
    /**
     * 現在位置から LOOK_AHEAD_MS 先までのイベントをスケジュール
     */
    private updateAutomationStream(): void {
        const tracks = this._app.tracksController.tracks;
        const currentTime = this._app.host.audioContext.currentTime;
        const currentPlayhead = this._app.host.playhead;
        const targetPlayhead = currentPlayhead + AutomationController.LOOK_AHEAD_MS;

        for (const track of tracks) {
            // 1. AudioParam系（Volume/Pan）は最初に一度だけ設定
            if (currentPlayhead <= this._lastScheduledPlayhead + 100) {
                // Volume
                const activeVolume = track.automationRegions.find(r => r.paramId === AutomationController.PARAM_VOLUME);
                if (activeVolume) {
                    this.applyToAudioParam(track.gainParameter, activeVolume.points, currentTime, currentPlayhead, false);
                } else {
                    const volumePoints = track.automationData.get(AutomationController.PARAM_VOLUME);
                    if (volumePoints && volumePoints.length > 0) {
                        this.applyToAudioParam(track.gainParameter, volumePoints, currentTime, currentPlayhead, false);
                    }
                }

                // Pan
                const activePan = track.automationRegions.find(r => r.paramId === AutomationController.PARAM_PAN);
                if (activePan) {
                    this.applyToAudioParam(track.panParameter, activePan.points, currentTime, currentPlayhead, true);
                } else {
                    const panPoints = track.automationData.get(AutomationController.PARAM_PAN);
                    if (panPoints && panPoints.length > 0) {
                        this.applyToAudioParam(track.panParameter, panPoints, currentTime, currentPlayhead, true);
                    }
                }
            }

            // 2. プラグインパラメータはストリーミングでスケジュール
            if (track.plugins.length === 0 || !track.plugins[0].instance?._audioNode) continue;
            const audioNode = track.plugins[0].instance._audioNode;

            // Current Automation (Active Regions)
            for (const region of track.automationRegions) {
                if (!region.paramId) continue;
                if (region.paramId === AutomationController.PARAM_VOLUME || region.paramId === AutomationController.PARAM_PAN) continue;

                this.schedulePointsInRange(audioNode, region.paramId, region.points, currentTime, currentPlayhead, targetPlayhead, track);
            }

            // Stored Automations (Other Parameters)
            const activeIds = new Set(track.automationRegions.map(r => r.paramId));
            for (const [paramId, points] of track.automationData) {
                if (activeIds.has(paramId)) continue;
                if (paramId === AutomationController.PARAM_VOLUME || paramId === AutomationController.PARAM_PAN) continue;
                if (points && points.length > 0) {
                    this.schedulePointsInRange(audioNode, paramId, points, currentTime, currentPlayhead, targetPlayhead, track);
                }
            }
        }

        this._lastScheduledPlayhead = targetPlayhead;
    }

    /**
     * 指定範囲内のポイントのみをスケジュール（ストリーミング用）
     */
    private async schedulePointsInRange(audioNode: any, paramId: string, points: any[], contextTime: number, fromPlayhead: number, toPlayhead: number, track: Track) {
        if (!points || points.length === 0) return;

        const events: any[] = [];
        const { min, max } = await this.getParamNormalizationInfo(track, paramId);
        const range = max - min;
        const denormalize = (val: number) => min + val * range;

        points.sort((a, b) => a.time - b.time);

        // 現在位置での補間値を設定（初回のみ）
        if (fromPlayhead <= this._lastScheduledPlayhead + 100) {
            let initialVal = this.interpolateValueAtTime(points, fromPlayhead);
            events.push({
                type: 'wam-automation',
                time: contextTime,
                data: { id: paramId, value: denormalize(initialVal) }
            });
        }

        // fromPlayhead〜toPlayhead 範囲内のポイントをスケジュール
        for (let i = 0; i < points.length; i++) {
            const p = points[i];
            if (p.time <= fromPlayhead) continue;
            if (p.time > toPlayhead) break;

            const deltaMs = p.time - this._app.host.playhead;
            const schedTime = contextTime + (deltaMs / 1000);

            events.push({
                type: 'wam-automation',
                time: schedTime,
                data: { id: paramId, value: denormalize(p.value) }
            });

            // ポイント間の補間イベントも追加（粒度を粗くして数を減らす）
            if (i < points.length - 1) {
                const nextP = points[i + 1];
                if (nextP.time <= toPlayhead) {
                    this.fillGapWithGranularEventsInRange(events, paramId, contextTime, this._app.host.playhead, p, nextP, denormalize, fromPlayhead, toPlayhead);
                }
            }
        }

        if (events.length > 0) {
            events.sort((a, b) => a.time - b.time);
            audioNode.scheduleEvents(...events);
        }
    }

    /**
     * 指定時間におけるオートメーション値を補間で計算
     */
    private interpolateValueAtTime(points: any[], timeMs: number): number {
        if (!points || points.length === 0) return 0.5;

        points.sort((a, b) => a.time - b.time);

        let prevPoint: AutomationPoint | null = null;
        let nextPoint: AutomationPoint | null = null;

        for (let i = 0; i < points.length; i++) {
            if (points[i].time <= timeMs) {
                prevPoint = points[i];
            } else {
                nextPoint = points[i];
                break;
            }
        }

        if (prevPoint && nextPoint) {
            return this.interpolateWithCurve(prevPoint, nextPoint, timeMs);
        } else if (prevPoint) {
            return prevPoint.value;
        } else if (nextPoint) {
            return nextPoint.value;
        }
        return 0.5;
    }

    /**
     * カーブモードに応じた補間計算
     */
    private interpolateWithCurve(prevPoint: AutomationPoint, nextPoint: AutomationPoint, timeMs: number): number {
        const t = (timeMs - prevPoint.time) / (nextPoint.time - prevPoint.time);
        const curveMode = prevPoint.curve ?? CurveMode.Linear;

        let curvedT: number;
        switch (curveMode) {
            case CurveMode.Step:
                // ジャンプ: 前のポイントの値をそのまま使用
                return prevPoint.value;
            case CurveMode.Fast:
                // ファースト: 急→緩やか (sqrt)
                curvedT = Math.sqrt(t);
                break;
            case CurveMode.Slow:
                // スロー: 緩やか→急 (square)
                curvedT = t * t;
                break;
            case CurveMode.Linear:
            default:
                curvedT = t;
                break;
        }

        return prevPoint.value * (1 - curvedT) + nextPoint.value * curvedT;
    }

    /**
     * 範囲内でのみ補間イベントを生成（カーブモード対応）
     */
    private fillGapWithGranularEventsInRange(events: any[], paramId: string, contextTime: number, currentPlayhead: number, startP: AutomationPoint, endP: AutomationPoint, denormalize: (v: number) => number, fromPlayhead: number, toPlayhead: number) {
        const durationMs = endP.time - startP.time;
        if (durationMs <= 0) return;

        const curveMode = startP.curve ?? CurveMode.Linear;

        // Step モードでは補間イベント不要（次のポイント時刻で一気にジャンプ）
        if (curveMode === CurveMode.Step) return;

        const granularityMs = AutomationController.RAMP_GRANULARITY * 1000;
        const steps = Math.floor(durationMs / granularityMs);

        if (steps <= 0) return;

        for (let s = 1; s <= steps; s++) {
            const timeOffsetMs = s * granularityMs;
            const absTimeMs = startP.time + timeOffsetMs;

            if (absTimeMs >= endP.time) break;
            if (absTimeMs <= fromPlayhead || absTimeMs > toPlayhead) continue;

            const t = timeOffsetMs / durationMs;

            // カーブモードに応じた補間
            let curvedT: number;
            switch (curveMode) {
                case CurveMode.Fast:
                    curvedT = Math.sqrt(t);
                    break;
                case CurveMode.Slow:
                    curvedT = t * t;
                    break;
                case CurveMode.Linear:
                default:
                    curvedT = t;
                    break;
            }

            const interpolatedVal = startP.value * (1 - curvedT) + endP.value * curvedT;

            const deltaFromPlayhead = absTimeMs - currentPlayhead;
            const schedTime = contextTime + (deltaFromPlayhead / 1000);

            events.push({
                type: 'wam-automation',
                time: schedTime,
                data: { id: paramId, value: denormalize(interpolatedVal) }
            });
        }
    }

    // 既存メソッドを残す（AudioParam用）
    private applyAutomationToTrack(track: Track, audioNode: any, paramId: string, points: any[], currentTime: number, currentPlayhead: number) {
        if (paramId === AutomationController.PARAM_VOLUME) {
            this.applyToAudioParam(track.gainParameter, points, currentTime, currentPlayhead, false);
        } else if (paramId === AutomationController.PARAM_PAN) {
            this.applyToAudioParam(track.panParameter, points, currentTime, currentPlayhead, true);
        } else {
            this.schedulePoints(audioNode, paramId, points, currentTime, currentPlayhead, track);
        }
    }

    private applyToAudioParam(param: AudioParam, points: any[], contextTime: number, currentPlayhead: number, isPan: boolean) {
        if (!points || points.length === 0) return;

        // Cancel scheduled values to avoid conflicts
        param.cancelScheduledValues(contextTime);

        // Sort just in case
        points.sort((a, b) => a.time - b.time);

        // Helper to map 0-1 to target range
        const mapValue = (val: number) => {
            if (isPan) return val * 2 - 1; // 0..1 -> -1..1
            return val; // 0..1 -> 0..1
        };

        // 1. Calculate and set initial value at contextTime
        let initialVal = points[0].value;
        let prevPoint = null;
        let nextPoint = null;

        for (let i = 0; i < points.length; i++) {
            if (points[i].time <= currentPlayhead) {
                prevPoint = points[i];
            } else {
                nextPoint = points[i];
                break;
            }
        }

        if (prevPoint && nextPoint) {
            // Interpolate
            const t = (currentPlayhead - prevPoint.time) / (nextPoint.time - prevPoint.time);
            initialVal = prevPoint.value * (1 - t) + nextPoint.value * t;
        } else if (prevPoint) {
            initialVal = prevPoint.value;
        } else if (nextPoint) {
            // Before first point. Use first point's value.
            initialVal = nextPoint.value;
        }

        // Apply initial value with discrete set to start the ramp from here
        param.setValueAtTime(mapValue(initialVal), contextTime);

        // 2. Schedule Ramps
        for (const p of points) {
            if (p.time > currentPlayhead) {
                const deltaMs = p.time - currentPlayhead;
                const schedTime = contextTime + (deltaMs / 1000);

                // Linear Ramp to target value
                // Since we set a value at contextTime, linearRamp will interpolate from there.
                param.linearRampToValueAtTime(mapValue(p.value), schedTime);
            }
        }
    }

    private async getParamNormalizationInfo(track: Track, paramId: string): Promise<{ min: number, max: number }> {
        if (track.plugins.length === 0 || !track.plugins[0].instance?._audioNode) return { min: 0, max: 1 };

        // Cache could be added here if performance is an issue
        const params = await track.plugins[0].instance._audioNode.getParameterInfo();
        if (params && params[paramId]) {
            return {
                min: params[paramId].minValue ?? 0,
                max: params[paramId].maxValue ?? 1
            };
        }
        return { min: 0, max: 1 };
    }

    private async schedulePoints(audioNode: any, paramId: string, points: any[], contextTime: number, currentPlayhead: number, track: Track) {
        if (!points || points.length === 0) return;

        const events: any[] = [];
        const { min, max } = await this.getParamNormalizationInfo(track, paramId);
        const range = max - min;

        const denormalize = (val: number) => min + val * range;

        // Sort points by time
        points.sort((a, b) => a.time - b.time);

        // 1. Calculate and set initial value at contextTime (current playback position)
        let initialVal = points[0].value;
        let prevPoint = null;
        let nextPoint = null;

        for (let i = 0; i < points.length; i++) {
            if (points[i].time <= currentPlayhead) {
                prevPoint = points[i];
            } else {
                nextPoint = points[i];
                break;
            }
        }

        if (prevPoint && nextPoint) {
            // Interpolate for initial value
            const t = (currentPlayhead - prevPoint.time) / (nextPoint.time - prevPoint.time);
            initialVal = prevPoint.value * (1 - t) + nextPoint.value * t;
        } else if (prevPoint) {
            initialVal = prevPoint.value;
        } else if (nextPoint) {
            initialVal = nextPoint.value;
        }

        // Add initial event immediately
        events.push({
            type: 'wam-automation',
            time: contextTime,
            data: { id: paramId, value: denormalize(initialVal) }
        });

        // 2. Schedule Future Events with Interpolation (Granular Ramp)

        let startIndex = points.findIndex(p => p.time > currentPlayhead);

        if (startIndex === -1) {
            if (events.length > 0) audioNode.scheduleEvents(...events);
            return;
        }

        if (prevPoint) {
            this.fillGapWithGranularEvents(events, paramId, contextTime, currentPlayhead,
                { time: currentPlayhead, value: initialVal },
                points[startIndex],
                denormalize
            );
        }

        // Now iterate through the remaining real points
        for (let i = startIndex; i < points.length; i++) {
            const p = points[i];

            const deltaMs = p.time - currentPlayhead;
            const schedTime = contextTime + (deltaMs / 1000);

            events.push({
                type: 'wam-automation',
                time: schedTime,
                data: { id: paramId, value: denormalize(p.value) }
            });

            if (i < points.length - 1) {
                const nextP = points[i + 1];
                this.fillGapWithGranularEvents(events, paramId, contextTime, currentPlayhead, p, nextP, denormalize);
            }
        }

        // Sort events by time before scheduling
        events.sort((a, b) => a.time - b.time);

        if (events.length > 0) {
            audioNode.scheduleEvents(...events);
        }
    }

    /**
     * Helper to generate intermediate automation events between two points.
     */
    private fillGapWithGranularEvents(events: any[], paramId: string, contextTime: number, currentPlayhead: number, startP: { time: number, value: number }, endP: { time: number, value: number }, denormalize: (v: number) => number) {
        const durationMs = endP.time - startP.time;
        if (durationMs <= 0) return;

        const granularityMs = AutomationController.RAMP_GRANULARITY * 1000;
        const steps = Math.floor(durationMs / granularityMs);

        if (steps <= 0) return;

        for (let s = 1; s <= steps; s++) {
            const timeOffsetMs = s * granularityMs;
            if (startP.time + timeOffsetMs >= endP.time) break;

            const t = timeOffsetMs / durationMs;
            const interpolatedVal = startP.value * (1 - t) + endP.value * t;

            const absTimeMs = startP.time + timeOffsetMs;
            const deltaFromPlayhead = absTimeMs - currentPlayhead;
            const schedTime = contextTime + (deltaFromPlayhead / 1000);

            events.push({
                type: 'wam-automation',
                time: schedTime,
                data: { id: paramId, value: denormalize(interpolatedVal) }
            });
        }
    }

    public updateBPFWidth(): void {
        // No-op
    }

    public static getStartingPoint(totalDuration: number, currentTime: number, totalPoint: number): number {
        const point = (totalPoint * currentTime) / totalDuration;
        const integPoint = Math.floor(point);
        const frac = point - integPoint;
        if (frac < 0.5) return integPoint;
        else return integPoint + 1;
    }
}
