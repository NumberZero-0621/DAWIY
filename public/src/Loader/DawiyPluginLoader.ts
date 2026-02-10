import App from "../App";
import { IDawiyPlugin, pluginRegistry } from "../DawiyPlugins/IDawiyPlugin";

// Declaration for Webpack's require.context
declare const require: {
    context(directory: string, useSubdirectories: boolean, regExp: RegExp): {
        keys(): string[];
        (id: string): any;
    };
};

export default class DawiyPluginLoader {
    private app: App;
    private plugins: IDawiyPlugin[] = [];
    private pluginGroups: Map<string, string> = new Map();

    constructor(app: App) {
        this.app = app;
    }

    public async init(): Promise<void> {
        this.plugins = [];
        this.pluginGroups.clear();
        await this.loadPlugins();
    }

    public getPlugins(): IDawiyPlugin[] {
        return this.plugins;
    }

    public getPluginGroup(pluginId: string): string {
        return this.pluginGroups.get(pluginId) || 'General';
    }

    private async loadPlugins() {
        try {
            // @ts-ignore
            const context = require.context('../DawiyPlugins', true, /\.(ts|js)$/);

            context.keys().forEach((key: string) => {
                if (key.includes('IDawiyPlugin') ||
                    key.includes('.d.ts') ||
                    key.includes('DawiyPluginBase')) return;
                context(key);
            });

            console.log(`[DawiyPluginLoader] Found ${pluginRegistry.length} plugins in registry.`);
            for (const PluginClass of pluginRegistry) {
                try {
                    const instance = new PluginClass(this.app);
                    if (this.plugins.some(p => p.id === instance.id)) {
                        console.warn(`Duplicate plugin ID found: ${instance.id}. Skipping.`);
                        continue;
                    }

                    this.plugins.push(instance);
                    this.pluginGroups.set(instance.id, instance.group || "General");

                    // Initialize Plugin with HostAPI
                    if (instance.onInit) {
                        try {
                            instance.onInit(this.app.hostAPI);
                        } catch (e) {
                            console.error(`Error initializing plugin ${instance.name}:`, e);
                        }
                    }

                    console.log(`[DawiyPluginLoader] Loaded: ${instance.name}`);

                } catch (e) {
                    console.error(`Failed to instantiate plugin:`, e);
                }
            }

            console.log(`[DawiyPluginLoader] Total loaded: ${this.plugins.length}`);

        } catch (e) {
            console.error("Error loading plugins:", e);
        }
    }
}
