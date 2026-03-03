import App from "../App";
// @ts-ignore
import { invoke } from "@tauri-apps/api/core";
import { isDesktop } from "../Utils/Environment";
import SettingsPersistenceController from "./SettingsPersistenceController";

export const DEFAULT_VST3_PATHS = [
    "C:\\Program Files\\Common Files\\VST3",
    "C:\\Program Files (x86)\\Common Files\\VST3",
    "C:\\Program Files (x86)\\Steinberg",
    "C:\\Program Files (x86)\\VstPlugins",
    "C:\\Program Files\\Cakewalk\\VstPlugins",
    "C:\\Program Files\\Steinberg",
    "C:\\Program Files\\VstPlugins"
];

export default class VstPluginController {
    app: App;
    public scannedPlugins: { name: string, path: string, vendor: string }[] = [];

    constructor(app: App) {
        this.app = app;
    }

    public async scanVstPlugins() {
        if (!isDesktop()) {
            this.app.showToast("VST scanning is only available in Desktop mode.", true);
            return;
        }

        try {
            this.app.showToast("Scanning for VST3 plugins...");
            const customPaths = SettingsPersistenceController.get<string[]>("vstPluginPaths", [...DEFAULT_VST3_PATHS]);

            const plugins = await invoke<{ name: string, path: string, vendor: string }[]>("scan_plugins", { customPaths });

            if (plugins.length === 0) {
                this.app.showToast("No VST3 plugins found.", true);
                this.scannedPlugins = [];
            } else {
                this.app.showToast(`Found ${plugins.length} VST3 plugins!`);
                console.log("Loaded VST3 Plugins:", plugins);
                this.scannedPlugins = plugins;
            }
            if (this.app.vstPluginManagerController) {
                this.app.vstPluginManagerController.refreshPluginsList();
            }
        } catch (e) {
            console.error(e);
            this.app.showToast("Failed to scan VST plugins: " + e, true);
        }
    }

    public async initAutoScan() {
        const isAutoScan = SettingsPersistenceController.get<boolean>("vstAutoScan", false);
        if (isAutoScan) {
            await this.scanVstPlugins();
        }
    }

    /**
     * Carlaを使用してVSTプラグインのGUIを開く
     * @param pluginPath VSTプラグインへのパス
     * @param carlaPath Carla実行ファイルへのパス（オプション）
     */
    public async openVstWithCarla(pluginPath: string, carlaPath?: string): Promise<void> {
        if (!isDesktop()) {
            this.app.showToast("VST GUI is only available in Desktop mode.", true);
            return;
        }

        try {
            this.app.showToast("Opening VST plugin with Carla...");
            const result = await invoke<string>("open_vst_with_carla", {
                pluginPath,
                carlaPath: carlaPath || null
            });
            console.log("[VST] Carla result:", result);
            this.app.showToast("VST plugin GUI opened successfully!");
        } catch (e) {
            console.error("[VST] Carla error:", e);
            this.app.showToast("Failed to open VST with Carla: " + e, true);
        }
    }

    /**
     * VSTプラグインのスタンドアロン版を起動（推奨）
     * @param pluginPath VSTプラグインへのパス
     */
    public async launchVstStandalone(pluginPath: string): Promise<void> {
        if (!isDesktop()) {
            this.app.showToast("VST is only available in Desktop mode.", true);
            return;
        }

        try {
            this.app.showToast("Opening Native Editor (Experimental)...");
            // Switch to Native Implementation
            const result = await invoke<string>("open_vst_editor", { path: pluginPath });
            console.log("[VST] Native launch result:", result);
            this.app.showToast("VST plugin launched (Native Mode)!");
        } catch (e) {
            console.error("[VST] Native Launch error:", e);
            this.app.showToast("Native Launch Failed: " + e, true);
        }
    }

    /**
     * 任意の実行ファイルを起動
     * @param exePath 実行ファイルへのパス
     */
    public async launchExecutable(exePath: string): Promise<void> {
        if (!isDesktop()) {
            return;
        }

        try {
            const result = await invoke<string>("launch_executable", { exePath });
            console.log("[VST] Executable launched:", result);
            this.app.showToast("Launched: " + exePath);
        } catch (e) {
            console.error("[VST] Launch error:", e);
            this.app.showToast("Failed to launch: " + e, true);
        }
    }

    /**
     * すべてのVSTプロセスを停止
     */
    public async stopAllVst(): Promise<void> {
        if (!isDesktop()) {
            return;
        }

        try {
            await invoke("stop_all_vst");
            console.log("[VST] All VST processes stopped");
        } catch (e) {
            console.error("[VST] Failed to stop VSTs:", e);
        }
    }

    /**
     * Carlaを停止
     */
    public async stopCarla(): Promise<void> {
        if (!isDesktop()) {
            return;
        }

        try {
            await invoke("stop_carla");
            console.log("[VST] Carla stopped");
        } catch (e) {
            console.error("[VST] Failed to stop Carla:", e);
        }
    }

    /**
     * VSTプラグインのGUIを開く（古いopen_vst_editorを使用 - Carla推奨）
     * @deprecated 代わりにopenVstWithCarlaを使用してください
     */
    public async openVstEditor(pluginPath: string): Promise<void> {
        if (!isDesktop()) {
            this.app.showToast("VST editing is only available in Desktop mode.", true);
            return;
        }

        try {
            await invoke("open_vst_editor", { path: pluginPath });
        } catch (e) {
            console.error("[VST] Editor error:", e);
            this.app.showToast("Failed to open VST editor: " + e, true);
        }
    }
}
