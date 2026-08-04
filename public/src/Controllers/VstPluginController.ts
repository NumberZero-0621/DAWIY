import App from "../App";
// @ts-ignore
import { invoke } from "@tauri-apps/api/core";
import { isDesktop } from "../Utils/Environment";
import SettingsPersistenceController from "./SettingsPersistenceController";
import { audioCtx } from "../index";

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
        this.scannedPlugins = SettingsPersistenceController.get<{ name: string, path: string, vendor: string }[]>("vstScannedPlugins", []);
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
            SettingsPersistenceController.save("vstScannedPlugins", this.scannedPlugins);

            if (this.app.vstPluginManagerController) {
                this.app.vstPluginManagerController.refreshPluginsList();
            }
            if (this.app.pluginsController) {
                this.app.pluginsController.updatePluginList();
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
            const result = await invoke<string>("open_vst_editor", {
                path: pluginPath,
                sampleRate: audioCtx.sampleRate,
                visible: true
            });
            console.log("[VST] Native launch result:", result);
            this.app.showToast("VST plugin launched (Native Mode)!");
        } catch (e) {
            console.error("[VST] Native Launch error:", e);
            this.app.showToast("Native Launch Failed: " + e, true);
        }
    }


}
