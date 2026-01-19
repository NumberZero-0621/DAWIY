import App from "../App";
import { IDawiyPlugin } from "./IDawiyPlugin";

/**
 * Base class for DAWIY Plugins.
 * Provides default implementations and utility methods.
 */
export default abstract class DawiyPluginBase implements IDawiyPlugin {
    abstract id: string;
    abstract name: string;
    abstract description: string;

    protected app: App;
    protected container: HTMLElement | null = null;
    protected dynamicImport = new Function('url', 'return import(url)');

    constructor(app: App) {
        this.app = app;
    }

    abstract render(container: HTMLElement): void;

    public onActivate() { }
    public onDeactivate() { }

    // Data Management
    getUserData(): any { return null; }
    setUserData(data: any): void { }
    getProjectData(): any { return null; }
    setProjectData(data: any): void { }

    /**
     * Statically validates and loads a plugin from a module.
     * @param module The imported module (result of require/import).
     * @param app The main App instance.
     * @returns A valid IDawiyPlugin instance or null.
     */
    static loadPlugin(module: any, app: App): IDawiyPlugin | null {
        // We expect "export default class ..."
        const PluginClass = module.default;

        if (PluginClass && typeof PluginClass === 'function') {
            try {
                const instance = new PluginClass(app);

                // Basic duck-typing validation
                if (instance.id && instance.name && typeof instance.render === 'function') {
                    // It's a valid plugin
                    return instance;
                } else {
                    console.warn(`[DawiyPluginBase] Invalid plugin structure. Missing id, name, or render().`);
                }
            } catch (e) {
                console.error(`[DawiyPluginBase] Failed to instantiate plugin class:`, e);
            }
        } else {
            // console.warn(`[DawiyPluginBase] No default export class found.`);
        }
        return null;
    }
}
