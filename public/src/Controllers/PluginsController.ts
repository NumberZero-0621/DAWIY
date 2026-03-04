import { WebAudioModule } from "@webaudiomodules/sdk";
import App, { crashOnDebug } from "../App";
import { BACKEND_URL } from "../Env";
import Plugin, { PluginInstance } from "../Models/Plugin";
import SoundProvider from "../Models/Track/SoundProvider";
import PluginsView from "../Views/PluginsView";

/**
 * Controller for the plugins view. This controller is responsible for selecting and removing plugins.
 * It also defines the listeners for the plugins view.
 * 
 * What is called a "root plugin" in this classes is a plugin directly loaded by
 * wam studio. Only one can be associated to a track. The default root plugin
 * is the Pedalboard.
 * 
 * ## Quick Doc
 * - For adding a new root plugin, add it to {@link WAM_LIST}
 * - For connecting a plugin to a tracj use {@link connectPlugin}
 */
export default class PluginsController {

    /* -~- CONFIGURATION -~- */
    /**
     * A list of the roots plugins.
     * Only one root plugin can be associated to a Track.
     * A root plugin can himself manage multiple WAM.
     **/
    public WAM_LIST: { [name: string]: { url: string, state?: any } } = {
        "Pedalboard2": { url: BACKEND_URL + "/pedalboard2/index.js", state: { plugins: [], library: BACKEND_URL + "/wamstudio_library.json" } },
    }

    /** The default WAM to load */
    readonly DEFAULT_WAM = "Pedalboard2"



    /**
     * App instance.
     */
    private _app: App;

    /**
     * Plugins view.
     */
    private _view: PluginsView;

    constructor(app: App) {
        this._app = app;
        this._view = this._app.pluginsView;

        this.bindEvents();

        this._view.maximized = false;
        this.updateRackSize();
        this.updatePluginList();
    }



    public get selected() { return this._app.tracksController.selected }

    /* -~- ROOT PLUGIN LOADING, CREATION, AND ASSOCIATION -~- */
    private wam_list_fetcheds: { [name: string]: { factory: typeof WebAudioModule } } = {}

    /**
     * Get a wam registred in the wam list if it exists else return null.
     * @param wam_name The name of the wam to fetch in {@link WAM_LIST} 
     */
    private async fetchWAM(wam_name: string): Promise<PluginsController['WAM_LIST']['_'] & { wam: typeof WebAudioModule } | null> {
        let infos = this.WAM_LIST[wam_name]
        if (!infos) return null

        let fetched = this.wam_list_fetcheds[wam_name]
        if (!fetched) {

            let { url } = infos
            let isVst = false;
            let realVstPath = "";

            // Intercept VST URLs
            if (url.startsWith("vst://")) {
                isVst = true;
                realVstPath = url.replace("vst://", "");
                // Redirect to VstProxy
                const baseUrl = BACKEND_URL.endsWith("/") ? BACKEND_URL.slice(0, -1) : BACKEND_URL;
                url = `${baseUrl}/plugins/VstProxy/index.js`;
            }

            try {
                const { default: WAM } = await import(/* webpackIgnore: true */url) as { default: typeof WebAudioModule };
                fetched = { factory: WAM }
                this.wam_list_fetcheds[wam_name] = fetched

                // If it was a VST, we need to ensure the state carries the path
                if (isVst) {
                    infos = { ...infos, url: url, state: { ...infos.state, vstPath: realVstPath } };
                    // Update the global list to point to proxy url too? No, keep original for identification?
                    // Actually, if we change 'infos' locally here, it's passed to return.
                    // But we also need to ensure 'new Plugin' gets this state.
                }

            }
            catch (e) {
                crashOnDebug(`Error while fetching WAM Plugin "${wam_name}": `, e)
                return null
            }
        }
        return { ...infos, wam: fetched.factory }
    }





    /**
     * Registers a new WAM dynamically.
     */
    public addWam(url: string, explicitName?: string) {
        let name = explicitName;

        if (!name) {
            // Use filename or a derived name as key
            const filename = url.split('/').pop()?.replace('.js', '') || 'UnknownWam';
            if (filename === 'index') {
                // Use parent folder name
                const parts = url.split('/');
                if (parts.length > 2) {
                    name = parts[parts.length - 2];
                } else {
                    name = filename;
                }
            } else {
                name = filename;
            }
        }

        // Avoid overwriting Pedalboard2 or existing
        const safeName = this.WAM_LIST[name!] && this.WAM_LIST[name!].url !== url ? name + '_' + Date.now() : name!;

        this.WAM_LIST[safeName] = { url: url };
        // Clear fetch cache for this name if it existed
        delete this.wam_list_fetcheds[safeName];

        this.updatePluginList();
    }

    public removeWam(url: string) {
        for (const name in this.WAM_LIST) {
            if (this.WAM_LIST[name].url === url) {
                delete this.WAM_LIST[name];
                delete this.wam_list_fetcheds[name];
            }
        }
        this.updatePluginList();
    }

    /**
     * Get a plugin from a registred root wam.
     * @param wam_name The name of the wam to fetch in {@link WAM_LIST} 
     */
    public async fetchPlugin(wam_name: string): Promise<Plugin | null> {
        const fetched = await this.fetchWAM(wam_name)
        if (fetched) return await new Plugin(wam_name, fetched.wam, fetched.state)
        else return null
    }

    /**
     * Connect a plugin to a track. (DEPRECATED: Use track.addPlugin)
     */
    public async connectPlugin(track: SoundProvider, plugin: Plugin | null) {
        if (plugin) {
            await track.addPlugin(plugin);
        } else {
            track.removeAllPlugins();
        }
        this.updatePluginList()
    }

    public async fxButtonClicked(track: SoundProvider) {
        this._app.tracksController.select(track);
        // We do not auto-instantiate Pedalboard anymore.
        // We just toggle the visibility of the rack itself, but rack is always partially visible if not collapsed.
        // For now, let's just make sure rack is minimized/maximized or just focus it.
        if (this._view.maximized) {
            this._view.minimize();
        } else {
            this._view.maximize();
        }
        this._app.hostController.focus(this._view);
    }

    private isPluginShown = false;
    private visiblePluginIndex = -1;

    private showPlugin(plugin: PluginInstance, index: number) {
        if (!plugin) return;

        const audioNode = plugin.instance?.audioNode as any;
        if (audioNode && typeof audioNode.showVstUi === "function") {
            audioNode.showVstUi();
            // GUI does not bind to DAWIY's floating DOM frame, so we don't treat it as "shown" in DAWIY.
            return;
        }

        if (!plugin.gui) return;
        this._view.showFloatingWindow(true);
        this.isPluginShown = true;
        this.visiblePluginIndex = index;
        this._view.setPluginView(plugin.gui);
        this._app.hostController.focus(this._view);
    }

    private hidePlugin() {
        this._view.showFloatingWindow(false);
        this.isPluginShown = false;
        this.visiblePluginIndex = -1;
        this._view.setPluginView(null);
    }

    /**
     * Binds the events of the plugins view.
     * @private
     */
    private bindEvents(): void {
        this._view.onAddClick = async (plugin_name) => {
            if (!this.selected) {
                this._app.showToast("プラグインを追加するトラックを選択してください", true);
                return;
            }

            // Handle VST plugins specifically
            if (plugin_name.startsWith("[VST3] ")) {
                const actualName = plugin_name.replace("[VST3] ", "");
                const vstPlugin = this._app.vstPluginController.scannedPlugins.find(p => p.name === actualName);
                if (vstPlugin) {
                    const vstUrl = `vst://${vstPlugin.path}`;
                    // Automatically add the VST to WAM_LIST so it can be fetched
                    this.addWam(vstUrl, actualName);

                    // DAWIY's VstProxy node will initialize the VST now
                    // Add the VST wrapper to the rack
                    try {
                        const plugin = await this.fetchPlugin(actualName);
                        if (plugin) {
                            await this.selected.addPlugin(plugin);
                            this.updatePluginList();
                        } else {
                            this._app.showToast(`Failed to fetch plugin: ${actualName}`, true);
                        }
                    } catch (e) {
                        console.error("Error adding VST to rack:", e);
                        this._app.showToast(`Error adding VST to rack: ${e}`, true);
                    }
                }
                return;
            }

            // Remove WAM prefix if it exists
            const actualName = plugin_name.startsWith("[WAM] ") ? plugin_name.replace("[WAM] ", "") : plugin_name;

            const pluginInfo = this.WAM_LIST[actualName];

            if (pluginInfo && pluginInfo.url && pluginInfo.url.startsWith("vst://")) {
                const vstPath = pluginInfo.url.replace("vst://", "");

                // Add the VST wrapper to the rack
                const plugin = await this.fetchPlugin(actualName);
                if (plugin) {
                    await this.selected.addPlugin(plugin);
                    this.updatePluginList();
                }
                return;
            }

            const plugin = await this.fetchPlugin(actualName);
            if (plugin) {
                await this.selected.addPlugin(plugin);
                this.updatePluginList();
            }
        };

        this._view.onRemovePluginClick = (index) => {
            if (!this.selected) return;

            // If deleting the currently visible plugin, hide it
            if (this.isPluginShown && this.visiblePluginIndex === index) {
                this.hidePlugin();
            } else if (this.visiblePluginIndex > index) {
                // Adjust index if a previous plugin was deleted
                this.visiblePluginIndex--;
            }

            this.selected.removePlugin(index);
            this.updatePluginList();
        };

        this._view.onToggleShowPluginClick = (pluginId, index) => {
            if (!this.selected) return;
            const targetPlugin = this.selected.plugins[index];
            if (!targetPlugin) return;

            if (this.isPluginShown && this.visiblePluginIndex === index) {
                this.hidePlugin();
                this.updatePluginList();
            } else {
                this.showPlugin(targetPlugin, index);
                this.updatePluginList();
            }
        };

        this._view.closeWindowButton.addEventListener("click", () => {
            this.hidePlugin();
            this.updatePluginList();
        });

        this._view.maxMinBtn.addEventListener("click", () => {
            this.updateRackSize();
        });

        this._view.mainTrack.addEventListener("click", () => {
            this._app.tracksController.select(this._app.host);
        });

        this._app.tracksController.afterSelectedChange.add(() => this.updatePluginList());
    }

    /**
     * Update the dom of the plugin list.
     */
    public updatePluginList() {
        const wamNames = Object.keys(this.WAM_LIST);
        const vstPlugins = this._app.vstPluginController?.scannedPlugins || [];
        const vstNames = vstPlugins.map(p => `[VST3] ${p.name}`);
        const filteredWamNames = wamNames.filter(name => !vstPlugins.some(p => p.name === name)).map(name => {
            if (name === "Pedalboard2") return `[WAM] ${name}`;
            return name;
        });
        const allNames = [...filteredWamNames, ...vstNames];

        if (!this.selected) {
            this._view.renderPluginList([], false);
            this._view.renderAddDropdown(allNames);
            this.hidePlugin();
        } else {
            const pluginDocs = this.selected.plugins.map((p, i) => ({
                name: p.name,
                isBypassed: false, // implementation needed later
                isVisible: this.isPluginShown && this.visiblePluginIndex === i
            }));

            this._view.renderPluginList(pluginDocs);
            this._view.renderAddDropdown(allNames);

            // Ensure GUI reflects current plugin state
            if (this.isPluginShown) {
                const p = this.selected.plugins[this.visiblePluginIndex];
                if (!p) {
                    this.hidePlugin();
                } else {
                    this._view.setPluginView(p.gui);
                }
            } else {
                this._view.setPluginView(null);
            }
        }
    }

    private updateRackSize(): void {
        const maximized = !this._view.maximized;
        this._view.maximized = maximized;
        if (maximized) {
            // Un-collapse
            this._view.minimize(); // Confusing, but this EXPANDS the view
            this._app.editorView.resizeCanvas();
        } else {
            // Collapse
            this._view.maximize(); // This COLLAPSES the view
            this._app.editorView.resizeCanvas();
        }
    }
}