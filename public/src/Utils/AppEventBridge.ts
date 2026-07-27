import App from "../App";
import Track from "../Models/Track/Track";
import TrackElement from "../Components/Editor/TrackElement";
import { audioCtx } from "../index";
import MIDIRegion from "../Models/Region/MIDIRegion";
import { MIDI, MIDINote } from "../Audio/MIDI/MIDI";
import { RegionOf } from "../Models/Region/Region";
import WaveformView from "../Views/Editor/WaveformView";
import RegionView from "../Views/Editor/Region/RegionView";

/**
 * Tauriマルチウィンドウ環境下で、独立したメモリ空間（V8ヒープ）で動作する
 * ポップアウトウィンドウ側プラグインと、メインウィンドウ側のDAW状態を同期・ブリッジするクラス。
 * 
 * BroadcastChannel を利用して同一アプリケーション内のウィンドウ間通信を処理します。
 */
export default class AppEventBridge {
    private static channel: BroadcastChannel | null = null;
    private static isInitialized = false;
    private static CHANNEL_NAME = "dawiy_tauri_popout_channel";
    private static sendTransport: ((msg: any) => void) | null = null;
    private static tauriUnlisten: (() => void) | null = null;
    private static messageListeners = new Set<(msg: any) => void>();

    private static async setupTransport(onMessage: (msg: any) => void): Promise<void> {
        this.messageListeners.add(onMessage);

        // BroadcastChannel のセットアップ (Web / 同一オリジン用)
        try {
            if (!this.channel) {
                this.channel = new BroadcastChannel(this.CHANNEL_NAME);
                this.channel.onmessage = (event) => {
                    this.messageListeners.forEach(fn => fn(event.data));
                };
            }
        } catch (e) {
            console.warn("BroadcastChannel init failed:", e);
        }

        // Tauri 環境下における公式イベント通信 (分離Webviewプロセス・マルチウィンドウ間での確実な同期)
        let tauriEmit: ((event: string, payload: any) => Promise<void>) | null = null;
        if ((window as any).__TAURI__ || (window as any).__TAURI_INTERNALS__) {
            try {
                const { emit, listen } = await import('@tauri-apps/api/event');
                tauriEmit = emit;
                if (this.tauriUnlisten) this.tauriUnlisten();
                this.tauriUnlisten = await listen(this.CHANNEL_NAME, (event: any) => {
                    this.messageListeners.forEach(fn => fn(event.payload));
                });
            } catch (e) {
                console.warn("Failed to init Tauri event transport:", e);
            }
        }

        this.sendTransport = (msg: any) => {
            if (tauriEmit) {
                tauriEmit(this.CHANNEL_NAME, msg).catch(e => console.warn("Tauri emit error:", e));
            }
            if (this.channel) {
                try { this.channel.postMessage(msg); } catch (e) {}
            }
        };
    }

    private static postMsg(msg: any): void {
        if (this.sendTransport) {
            this.sendTransport(msg);
        } else if (this.channel) {
            try { this.channel.postMessage(msg); } catch (e) {}
        }
    }

    /**
     * メインウィンドウ側で呼び出され、ポップアウトからのリクエストを受信するサーバー／プロキシとして初期化。
     */
    public static initMain(app: App): void {
        if (this.isInitialized && (this.sendTransport || this.channel)) return;
        this.isInitialized = true;

        this.setupTransport(async (msg: any) => {
            if (!msg || !msg.type) return;

            switch (msg.type) {
                case "GET_STATE":
                    this.broadcastStateSnapshot(app, msg.requestId, msg.payload?.extId);
                    break;

                case "CREATE_TRACK":
                    try {
                        const newTrack = await app.tracksController.createTrack(msg.payload?.name);
                        if (msg.requestId) {
                            this.postMsg({
                                type: "CREATE_TRACK_RESPONSE",
                                requestId: msg.requestId,
                                track: {
                                    id: newTrack.id,
                                    name: newTrack.element.name,
                                    color: newTrack.color
                                }
                            });
                        }
                        this.broadcastStateSnapshot(app);
                    } catch (e) {
                        console.error("AppEventBridge: Error in CREATE_TRACK", e);
                    }
                    break;

                case "SELECT_TRACK":
                    if (msg.payload?.trackId !== undefined && msg.payload?.trackId !== null) {
                        const track = app.tracksController.getTrackById(msg.payload.trackId);
                        if (track) app.tracksController.select(track);
                    }
                    break;

                case "SET_TRACK_COLOR":
                    if (msg.payload?.trackId !== undefined && msg.payload?.trackId !== null && msg.payload?.color) {
                        const track = app.tracksController.getTrackById(msg.payload.trackId);
                        if (track) app.tracksController.setColor(track, msg.payload.color);
                    }
                    break;

                case "ADD_REGION":
                    this.handleAddRegion(app, msg.payload);
                    break;

                case "REMOVE_REGION":
                    break;

                case "SHOW_TOAST":
                    if (msg.payload?.message) {
                        app.hostAPI.ui.showToast(msg.payload.message, !!msg.payload.isError);
                    }
                    break;

                case "UPDATE_PLUGIN_DATA":
                    this.handleUpdatePluginData(app, msg.payload);
                    break;

                case "POPOUT_CLOSED":
                    this.handlePopoutClosed(app, msg.payload);
                    break;
            }
        });

        // トラック変更時に自動的に状態をブロードキャストするフック
        const origAddTrack = app.tracksController.addTrack.bind(app.tracksController);
        app.tracksController.addTrack = async (track) => {
            await origAddTrack(track);
            this.broadcastStateSnapshot(app);
        };
        const origRemoveTrack = app.tracksController.removeTrack.bind(app.tracksController);
        app.tracksController.removeTrack = (track) => {
            origRemoveTrack(track);
            this.broadcastStateSnapshot(app);
        };
        app.tracksController.afterSelectedChange.add(() => {
            this.broadcastStateSnapshot(app);
        });
    }

    /**
     * メイン画面から現在のトラック構成等の状態スナップショットをブロードキャストする
     */
    public static broadcastStateSnapshot(app: App, targetRequestId?: string, targetExtId?: string): void {
        const tracksData = app.tracksController.tracks.map(t => ({
            id: t.id,
            name: t.element.name,
            color: t.color,
            isMuted: t.isMuted,
            isSolo: t.isSolo
        }));

        let pluginData = null;
        const extId = targetExtId || app.dawiyPluginController.activeExtensionId;
        if (extId) {
            const ext = app.dawiyPluginController.installedExtensions.find(e => e.id === extId);
            if (ext) {
                pluginData = {
                    extId: extId,
                    userData: ext.getUserData ? ext.getUserData() : null,
                    projectData: ext.getProjectData ? ext.getProjectData() : null
                };
            }
        }

        this.postMsg({
            type: "STATE_SNAPSHOT",
            requestId: targetRequestId,
            payload: {
                tracks: tracksData,
                selectedTrackId: app.tracksController.selectedTrack ? app.tracksController.selectedTrack.id : null,
                playhead: app.host.playhead || 0,
                timeSignature: app.hostView?.metronome?.timeSignature || [4, 4],
                pluginData: pluginData
            }
        });
    }

    private static handleAddRegion(app: App, payload: any): void {
        if (!payload || payload.trackId === undefined || payload.trackId === null || !payload.region) return;

        const track = app.tracksController.getTrackById(payload.trackId) || app.tracksController.selectedTrack;
        if (!track) return;

        const regData = payload.region;
        let region: any;

        if (regData.type === "MIDI" && regData.midi) {
            const midi = new MIDI(500, regData.midi.durationMs || regData.durationMs || 1000);
            if (regData.midi.notes && Array.isArray(regData.midi.notes)) {
                regData.midi.notes.forEach((n: any) => {
                    midi.putNote(new MIDINote(n.pitch, n.velocity ?? 100, 0, n.durationMs), n.startMs);
                });
            }
            region = new MIDIRegion(midi, regData.startMs || 0);
        } else {
            return;
        }

        app.doIt(true,
            () => {
                app.regionsController.addRegion(track, region);
                if (app.pianoRollController.isVisible) app.pianoRollController.redraw();
            },
            () => {
                app.regionsController.removeRegion(region);
                if (app.pianoRollController.isVisible) app.pianoRollController.redraw();
            }
        );
    }

    private static handleUpdatePluginData(app: App, payload: any): void {
        if (!payload || !payload.extId) return;
        const ext = app.dawiyPluginController.installedExtensions.find(e => e.id === payload.extId);
        if (!ext) return;

        try {
            if (payload.projectData && ext.setProjectData) {
                ext.setProjectData(payload.projectData);
            }
            if (payload.userData && ext.setUserData) {
                ext.setUserData(payload.userData);
            }
        } catch (e) {
            console.warn(`AppEventBridge: Failed to sync plugin data for ${payload.extId}`, e);
        }
    }

    private static handlePopoutClosed(app: App, payload: any): void {
        if (payload && payload.extId) {
            this.handleUpdatePluginData(app, payload);
            if (app.dawiyPluginController.activeExtensionId === payload.extId) {
                app.dawiyPluginController.onPopoutWindowClosedExternal();
            }
        }
    }

    /**
     * ポップアウトウィンドウ側で初期化され、メインウィンドウとの通信および
     * ポップアウト内 App インスタンスのプロキシ化を行う。
     */
    public static async initPopout(app: App, popoutExtId: string): Promise<void> {
        if (this.isInitialized && (this.sendTransport || this.channel)) return;
        this.isInitialized = true;

        return new Promise<void>(async (resolve) => {
            try {
                let resolved = false;
                const finish = () => {
                    if (!resolved) {
                        resolved = true;
                        resolve();
                    }
                };
                const timeoutId = setTimeout(finish, 800);

                await this.setupTransport((msg: any) => {
                    if (!msg || !msg.type) return;

                    if (msg.type === "STATE_SNAPSHOT") {
                        this.syncPopoutStateFromSnapshot(app, msg.payload);
                        if (msg.requestId && msg.requestId.startsWith("init_")) {
                            clearTimeout(timeoutId);
                            finish();
                        }
                    }
                });

                // プロキシのセットアップ
                this.setupPopoutProxies(app, popoutExtId);

                // ポップアウト側からトラック選択が変更された場合もメイン画面へ反映（双方向同期）
                app.tracksController.afterSelectedChange.add((_, selected) => {
                    if (selected && selected.id !== undefined && selected.id !== null) {
                        this.postMsg({
                            type: "SELECT_TRACK",
                            payload: { trackId: selected.id }
                        });
                    }
                });

                // メインウィンドウへ現在の状態スナップショットを要求 (少し間隔を空けて再送するリトライ付き)
                const sendInitReq = () => {
                    if (resolved) return;
                    const initReqId = "init_" + Date.now();
                    this.postMsg({ type: "GET_STATE", requestId: initReqId, payload: { extId: popoutExtId } });
                };
                sendInitReq();
                const retryId = setInterval(() => {
                    if (resolved) {
                        clearInterval(retryId);
                    } else {
                        sendInitReq();
                    }
                }, 150);

                // ウィンドウ終了時や操作時に状態をメイン画面へ通知
                const sendCloseNotice = () => {
                    const ext = app.dawiyPluginController.installedExtensions.find(e => e.id === popoutExtId);
                    this.postMsg({
                        type: "POPOUT_CLOSED",
                        payload: {
                            extId: popoutExtId,
                            projectData: ext?.getProjectData ? ext.getProjectData() : null,
                            userData: ext?.getUserData ? ext.getUserData() : null
                        }
                    });
                };
                window.addEventListener("beforeunload", sendCloseNotice);
                window.addEventListener("unload", sendCloseNotice);

                // UI操作時にリアルタイムで状態同期をメイン画面へ送る
                const syncPluginDataToMain = () => {
                    const ext = app.dawiyPluginController.installedExtensions.find(e => e.id === popoutExtId);
                    if (ext) {
                        this.postMsg({
                            type: "UPDATE_PLUGIN_DATA",
                            payload: {
                                extId: popoutExtId,
                                projectData: ext.getProjectData ? ext.getProjectData() : null,
                                userData: ext.getUserData ? ext.getUserData() : null
                            }
                        });
                    }
                };
                window.addEventListener("input", syncPluginDataToMain, true);
                window.addEventListener("change", syncPluginDataToMain, true);
                window.addEventListener("click", syncPluginDataToMain, true);
                window.addEventListener("mouseup", syncPluginDataToMain, true);
                window.addEventListener("keyup", syncPluginDataToMain, true);

            } catch (e) {
                console.warn("AppEventBridge (Popout): Failed to initialize transport", e);
                resolve();
            }
        });
    }

    private static syncPopoutStateFromSnapshot(app: App, payload: any): void {
        if (!payload) return;

        if (payload.playhead !== undefined) {
            app.host.playhead = payload.playhead;
        }
        if (payload.timeSignature && app.hostView?.metronome) {
            app.hostView.metronome.timeSignature = payload.timeSignature;
        }

        if (payload.tracks && Array.isArray(payload.tracks)) {
            payload.tracks.forEach((tData: any) => {
                let track = app.tracksController.tracks.find(t => t.id === tData.id);
                if (!track) {
                    track = new Track(new TrackElement(), audioCtx, app.host.hostGroupId);
                    track.id = tData.id;
                    track.element.trackId = tData.id;
                    app.tracksController.trackIdCount = Math.max(app.tracksController.trackIdCount, tData.id + 1);
                    (app.tracksController.tracks as any).push(track);
                }
                track.element.name = tData.name;
                track.color = tData.color;
            });

            if (payload.selectedTrackId !== undefined && payload.selectedTrackId !== null) {
                const selected = app.tracksController.getTrackById(payload.selectedTrackId);
                if (selected) {
                    app.tracksController.select(selected);
                }
            }
        }

        if (payload.pluginData && payload.pluginData.extId) {
            this.handleUpdatePluginData(app, payload.pluginData);
        }
    }

    private static setupPopoutProxies(app: App, popoutExtId: string): void {
        // 1. tracksController.createTrack のプロキシ化
        const origCreateTrack = app.tracksController.createTrack.bind(app.tracksController);
        app.tracksController.createTrack = async (urlOrName?: string): Promise<Track> => {
            const name = urlOrName ? urlOrName.split("/").pop() || "Track" : "Track";
            const reqId = "req_create_" + Date.now() + "_" + Math.random().toString(36).substr(2, 5);

            return new Promise<Track>((resolve) => {
                const handler = (msg: any) => {
                    if (msg && msg.type === "CREATE_TRACK_RESPONSE" && msg.requestId === reqId) {
                        this.messageListeners.delete(handler);
                        const tData = msg.track;
                        let track = app.tracksController.tracks.find(t => t.id === tData.id);
                        if (!track) {
                            track = new Track(new TrackElement(), audioCtx, app.host.hostGroupId);
                            track.id = tData.id;
                            track.element.trackId = tData.id;
                            track.element.name = tData.name;
                            track.color = tData.color;
                            (app.tracksController.tracks as any).push(track);
                        }
                        resolve(track);
                    }
                };
                this.messageListeners.add(handler);
                this.postMsg({ type: "CREATE_TRACK", requestId: reqId, payload: { name } });

                setTimeout(async () => {
                    this.messageListeners.delete(handler);
                    try {
                        const localTrack = await origCreateTrack(urlOrName);
                        resolve(localTrack);
                    } catch (e) {
                        console.error("AppEventBridge fallback createTrack failed", e);
                    }
                }, 1500);
            });
        };

        // 2. regionsController.addRegion のプロキシ化
        const origAddRegion = app.regionsController.addRegion.bind(app.regionsController);
        app.regionsController.addRegion = <T extends RegionOf<T>>(track: Track, region: RegionOf<T>, waveform?: WaveformView): RegionView<T> => {
            this.postMsg({
                type: "ADD_REGION",
                payload: {
                    trackId: track.id,
                    region: {
                        type: region instanceof MIDIRegion || (region as any).midi ? "MIDI" : "AUDIO",
                        startMs: (region as any).start || (region as any).startMs || 0,
                        durationMs: (region as any).duration || (region as any).durationMs || 0,
                        midi: (region as any).midi ? {
                            tempo: (region as any).midi.tempo || 500,
                            durationMs: (region as any).midi.durationMs || (region as any).duration || 0,
                            notes: (region as any).midi.notes ? (region as any).midi.notes.map((n: any) => ({
                                pitch: n.pitch,
                                velocity: n.velocity,
                                startMs: n.start || n.startMs || 0,
                                durationMs: n.duration || n.durationMs || 0
                            })) : []
                        } : null
                    }
                }
            });
            try { return origAddRegion(track, region, waveform); } catch (e) { return null as any; }
        };

        // 3. hostAPI.ui.showToast のプロキシ化
        const origShowToast = app.hostAPI.ui.showToast.bind(app.hostAPI.ui);
        app.hostAPI.ui.showToast = (message: string, isError?: boolean) => {
            this.postMsg({
                type: "SHOW_TOAST",
                payload: { message, isError }
            });
            try { origShowToast(message, isError); } catch (e) {}
        };

        // 4. プラグインデータの定期/アクション時送信のセットアップ
        const ext = app.dawiyPluginController.installedExtensions.find(e => e.id === popoutExtId);
        if (ext) {
            setInterval(() => {
                this.postMsg({
                    type: "UPDATE_PLUGIN_DATA",
                    payload: {
                        extId: popoutExtId,
                        projectData: ext.getProjectData ? ext.getProjectData() : null,
                        userData: ext.getUserData ? ext.getUserData() : null
                    }
                });
            }, 400);
        }
    }
}
