import App from "../App";
// @ts-ignore
import { invoke } from "@tauri-apps/api/core";
import { isDesktop } from "../Utils/Environment";

export default class VstPluginController {
    app: App;

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
            const plugins = await invoke<{ name: string, path: string, vendor: string }[]>("scan_plugins");

            if (plugins.length === 0) {
                this.app.showToast("No VST3 plugins found.", true);
            } else {
                this.app.showToast(`Found ${plugins.length} VST3 plugins!`);
                console.log("Loaded VST3 Plugins:", plugins);

                // Add to available WAMs list so they appear in the UI
                plugins.forEach(p => {
                    const wamInfo = {
                        name: p.name,
                        url: `vst://${p.path}`, // Virtual URL for identification
                        vendor: p.vendor,
                        description: p.path
                    };

                    this.app.wamPluginController.addAvailableWam(wamInfo);
                });
            }
        } catch (e) {
            console.error(e);
            this.app.showToast("Failed to scan VST plugins: " + e, true);
        }
    }
}
