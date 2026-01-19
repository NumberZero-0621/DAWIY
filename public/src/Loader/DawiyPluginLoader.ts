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
    private loadedScripts: Set<string> = new Set();

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
            this.plugins = [];
            // @ts-ignore
            const context = require.context('../DawiyPlugins', true, /\.(ts|js|json)$/);

            // ディレクトリごとにリソース（クラス、設定）をまとめるマップ
            const pluginModules: Map<string, { class?: any, config?: any, path: string }> = new Map();

            // 1. ファイルスキャン & グルーピング
            context.keys().forEach((key: string) => {
                // 除外ファイル
                if (key.includes('IDawiyPlugin') || key.includes('README') || key.includes('.d.ts') || key.includes('DawiyPluginBase')) return;

                // ディレクトリパスを取得 (例: "./MyPlugin/index.ts" -> "./MyPlugin")
                const dir = key.substring(0, key.lastIndexOf('/'));

                if (!pluginModules.has(dir)) {
                    pluginModules.set(dir, { path: dir });
                }
                const entry = pluginModules.get(dir)!;

                if (key.endsWith('plugin.json')) {
                    entry.config = context(key);
                } else if (key.match(/\.(ts|js)$/)) {
                    // モジュールを読み込み、default export (クラス) を取得
                    const module = context(key);
                    if (module.default) {
                        entry.class = module.default;
                    }
                }
            });

            // 2. 解決 & インスタンス化
            for (const [dir, entry] of pluginModules) {
                if (!entry.class) continue; // クラスがないディレクトリはスキップ

                const PluginClass = entry.class;
                const config = entry.config || {}; // Configがない場合は空

                try {
                    // インスタンス化
                    const instance = new PluginClass(this.app);

                    // バリデーション
                    if (instance.id && typeof instance.render === 'function') {

                        // --- Externalのプログラム解決 & 注入 ---
                        if (config.externals && typeof config.externals === 'object') {
                            const loadedExternals: { [key: string]: any } = {};

                            for (const key of Object.keys(config.externals)) {
                                const url = config.externals[key];
                                try {
                                    console.log(`[Plugin: ${instance.name}] Importing external: ${key}`);
                                    // ダイナミックインポートでモジュールとして取得
                                    // @ts-ignore
                                    const module = await import(/* webpackIgnore: true */ url);
                                    loadedExternals[key] = module;
                                } catch (e) {
                                    console.warn(`Failed to import external ${key} for ${instance.name}:`, e);
                                }
                            }

                            // プラグインに注入 (インターフェースに定義されている場合)
                            if (instance.setExternals) {
                                instance.setExternals(loadedExternals);
                            }
                        }
                        // ------------------------------------------

                        // Dependencies (loadScript) は config.dependencies がある場合のみ実行
                        // プログラムベースのExternal解決だけで良ければ、plugin.jsonのdependenciesは空にすれば良い
                        if (config.dependencies) {
                            for (const url of config.dependencies) {
                                await this.loadScript(url);
                            }
                        }

                        this.plugins.push(instance);

                        // グループ設定など
                        this.pluginGroups.set(instance.id, 'General'); // 必要ならconfigから取得可能
                        console.log(`[DawiyPluginLoader] Loaded: ${instance.name}`);
                    }
                } catch (e) {
                    console.error(`Failed to load plugin from ${dir}:`, e);
                }
            }

            console.log(`[DawiyPluginLoader] Total loaded: ${this.plugins.length}`);

        } catch (e) {
            console.error("Error loading plugins:", e);
        }
    }

    private loadScript(url: string): Promise<void> {
        if (this.loadedScripts.has(url)) return Promise.resolve();

        return new Promise((resolve, reject) => {
            console.log(`Loading dependency: ${url} `);
            const script = document.createElement('script');
            script.src = url;
            script.onload = () => {
                this.loadedScripts.add(url);
                console.log(`Loaded: ${url} `);
                resolve();
            };
            script.onerror = (e) => {
                console.error(`Failed to load script: ${url} `, e);
                reject(e);
            };
            document.head.appendChild(script);
        });
    }
}
