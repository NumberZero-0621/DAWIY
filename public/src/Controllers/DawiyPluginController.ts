import App from "../App";
import DawiyPluginView from "../Views/DawiyPluginView";
import JSZip from "jszip";
import { saveAs } from "file-saver";
import { IDawiyPlugin } from "../DawiyPlugins/IDawiyPlugin";

// Declaration for Webpack's require.context
declare const require: {
    context(directory: string, useSubdirectories: boolean, regExp: RegExp): {
        keys(): string[];
        (id: string): any;
    };
};

export default class DawiyPluginController {

    private app: App;
    private view: DawiyPluginView;

    // Extensions list
    private installedExtensions: IDawiyPlugin[];

    private activeExtensionId: string | null = null;
    private currentFilter: 'all' | 'installed' | 'not-installed' = 'all';

    private getUserDataKey(pluginId: string): string {
        return `dawiy_plugin_user_data_${pluginId}`;
    }

    constructor(app: App) {
        this.app = app;
        this.installedExtensions = [];
        this.loadPlugins();
    }

    private loadedScripts: Set<string> = new Set();

    /**
     * Automatically loads plugins from the ../DawiyPlugins directory.
     */
    private async loadPlugins() {
        try {
            // Include .json for config, .ts/.js for plugins
            // @ts-ignore
            const context = require.context('../DawiyPlugins', true, /\.(ts|js|json)$/);

            const pluginConfigs: { [key: string]: any } = {};
            const pluginFiles: string[] = [];

            context.keys().forEach((key: string) => {
                if (key.includes('IDawiyPlugin') || key.includes('README') || key.includes('.d.ts') || key.includes('.map') || key.includes('PluginTemplate')) return;

                if (key.endsWith('plugin.json')) {
                    pluginConfigs[key] = context(key);
                } else if (key.match(/\.(ts|js)$/)) {
                    pluginFiles.push(key);
                }
            });

            // process configs first
            for (const configPath of Object.keys(pluginConfigs)) {
                const config = pluginConfigs[configPath];
                if (config.dependencies && Array.isArray(config.dependencies)) {
                    for (const url of config.dependencies) {
                        await this.loadScript(url);
                    }
                }

                // If config has an entry, we might want to prioritize it or handle it specifically
                // For now, we rely on the loop below to pick up the .ts/.js file
                // But we should probably mark it as "ready" if we were doing strict dependency management
            }

            // Load all plugin files
            pluginFiles.forEach(key => {
                try {
                    const module = context(key);
                    // We expect "export default class ..."
                    const PluginClass = module.default;

                    if (PluginClass && typeof PluginClass === 'function') {
                        const instance = new PluginClass(this.app);

                        // Basic duck-typing validation to ensure it's a valid plugin
                        if (instance.id && instance.name && typeof instance.render === 'function') {
                            // Check for duplicates
                            // Check for duplicates
                            if (!this.installedExtensions.find(ext => ext.id === instance.id)) {
                                this.installedExtensions.push(instance);
                                // Load User Data
                                if (instance.setUserData) {
                                    try {
                                        const stored = localStorage.getItem(this.getUserDataKey(instance.id));
                                        if (stored) {
                                            instance.setUserData(JSON.parse(stored));
                                        }
                                    } catch (e) {
                                        console.warn(`Failed to load user data for plugin ${instance.name}`, e);
                                    }
                                }
                            }
                        }
                    }
                } catch (err) {
                    console.warn(`Failed to load plugin from ${key}:`, err);
                }
            });

            console.log(`Loaded ${this.installedExtensions.length} DAWIY plugins.`);

        } catch (e) {
            console.error("Error loading plugins automatically:", e);
        }
    }

    private loadScript(url: string): Promise<void> {
        if (this.loadedScripts.has(url)) return Promise.resolve();

        return new Promise((resolve, reject) => {
            console.log(`Loading dependency: ${url}`);
            const script = document.createElement('script');
            script.src = url;
            script.onload = () => {
                this.loadedScripts.add(url);
                console.log(`Loaded: ${url}`);
                resolve();
            };
            script.onerror = (e) => {
                console.error(`Failed to load script: ${url}`, e);
                reject(e);
            };
            document.head.appendChild(script);
        });
    }

    public setView(view: DawiyPluginView) {
        this.view = view;
        this.bindEvents();
        this.refreshBottomPanel(); // Initialize bottom panel
    }

    public openWindow() {
        this.view.show();
        this.filterPlugins('all'); // Reset to all and refresh list
    }

    private bindEvents() {
        // Save user data periodically or on unload
        window.addEventListener("beforeunload", () => {
            this.saveAllUserData();
        });

        this.view.closeBtn.onclick = () => this.view.hide();

        this.view.filterAllBtn.onclick = () => this.filterPlugins('all');
        this.view.filterInstalledBtn.onclick = () => this.filterPlugins('installed');
        this.view.filterNotInstalledBtn.onclick = () => this.filterPlugins('not-installed');

        this.view.addManualBtn.onclick = () => {
            this.view.addManualInput.click();
        }

        this.view.addManualInput.onchange = () => {
            const files = this.view.addManualInput.files;
            if (!files || files.length === 0) return;
            const file = files[0];
            this.handleFileUpload(file);
            this.view.addManualInput.value = ''; // Reset
        }

        // Creator UI
        if (this.view.filterCreatorBtn) {
            this.view.filterCreatorBtn.onclick = () => this.showCreator();
        }
        if (this.view.creatorCancelBtn) {
            this.view.creatorCancelBtn.onclick = () => this.hideCreator();
        }
        if (this.view.creatorGenerateBtn) {
            this.view.creatorGenerateBtn.onclick = () => this.handleGeneratePlugin();
        }

        // Drag & Drop
        if (this.view.creatorDropZone) {
            this.view.creatorDropZone.ondragover = (e) => {
                e.preventDefault();
                this.view.creatorDropZone.style.border = "2px dashed #0c85d0";
                this.view.creatorDropZone.style.color = "#0c85d0";
            };
            this.view.creatorDropZone.ondragleave = (e) => {
                this.view.creatorDropZone.style.border = "2px dashed #555";
                this.view.creatorDropZone.style.color = "#aaa";
            };
            this.view.creatorDropZone.ondrop = (e) => {
                e.preventDefault();
                this.view.creatorDropZone.style.border = "2px dashed #555";
                this.view.creatorDropZone.style.color = "#aaa";

                if (e.dataTransfer && e.dataTransfer.files.length > 0) {
                    this.handleCreatorDrop(e.dataTransfer.files[0]);
                }
            };
        }
    }

    private async handleCreatorDrop(file: File) {
        if (!file.name.match(/\.(ts|js)$/)) {
            this.app.showToast("Please drop a .ts or .js file.", true);
            return;
        }

        const text = await file.text();
        this.analyzePluginCode(text, file.name);
    }

    private analyzePluginCode(code: string, filename: string) {
        // 1. Extract Class Name
        // Match "export default class MyClass" or "class MyClass implements"
        let className = "";
        const classMatch = code.match(/class\s+(\w+)\s+implements\s+IDawiyPlugin/);
        if (classMatch) {
            className = classMatch[1];
        } else {
            // Fallback: filename base
            className = filename.replace(/\.(ts|js)$/, "");
        }

        // 2. Extract Plugin Name (name = "...")
        let pluginName = "";
        const nameMatch = code.match(/name\s*=\s*['"](.+?)['"]/);
        if (nameMatch) {
            pluginName = nameMatch[1];
        }

        // 3. Extract Description
        let desc = "";
        const descMatch = code.match(/description\s*=\s*['"](.*?)['"]/);
        if (descMatch) {
            desc = descMatch[1];
        }

        // 4. Extract Imports for Dependencies
        const deps: string[] = [];
        const importRegex = /from\s+['"](.+?)['"]/g;
        let match;
        while ((match = importRegex.exec(code)) !== null) {
            const pkg = match[1];
            if (pkg.startsWith(".") || pkg.startsWith("/")) continue; // Ignore relative/absolute paths
            if (pkg === "jszip") continue; // internalized? or common

            // Simple heuristic mapping
            if (pkg === "tonal" || pkg.startsWith("@tonaljs")) {
                deps.push("https://cdn.jsdelivr.net/npm/tonal/browser/tonal.min.js");
            } else if (pkg === "jquery") {
                deps.push("https://code.jquery.com/jquery-3.6.0.min.js");
            } else if (pkg === "lodash") {
                deps.push("https://cdn.jsdelivr.net/npm/lodash@4.17.21/lodash.min.js");
            } else if (pkg === "pixi.js") {
                // assume included in dawiy, but maybe they want external?
                // Skip for now as Dawiy includes Pixi
                continue;
            } else {
                // Just add a placeholder or the package name so user can fix it
                deps.push(`https://cdn.jsdelivr.net/npm/${pkg}/+esm`); // basic guess
            }
        }

        // Fill Form
        this.view.creatorClassInput.value = className;
        this.view.creatorNameInput.value = pluginName;
        this.view.creatorDescInput.value = desc;
        this.view.creatorDepsInput.value = [...new Set(deps)].join("\n"); // unique

        this.app.showToast("Auto-filled from file content!", false);
    }

    private showCreator() {
        this.view.listContainer.style.display = 'none';
        this.view.creatorContainer.style.display = 'block';

        // Reset active state of other filters
        this.view.filterAllBtn.classList.remove('active');
        this.view.filterInstalledBtn.classList.remove('active');
        this.view.filterNotInstalledBtn.classList.remove('active');
        this.view.filterCreatorBtn.classList.add('active');
    }

    private hideCreator() {
        this.view.listContainer.style.display = 'block';
        this.view.creatorContainer.style.display = 'none';
        this.view.filterCreatorBtn.classList.remove('active');

        // Default back to 'all'
        this.filterPlugins('all');
    }

    private async handleGeneratePlugin() {
        const name = this.view.creatorNameInput.value.trim();
        const className = this.view.creatorClassInput.value.trim();
        const desc = this.view.creatorDescInput.value.trim();
        const depsText = this.view.creatorDepsInput.value.trim();

        if (!name || !className) {
            this.app.showToast("Plugin Name and Class Name are required.", true);
            return;
        }

        // Validate ClassName (basic check)
        if (!/^[A-Za-z0-9_]+$/.test(className)) {
            this.app.showToast("Class Name must contain only letters, numbers, and underscores.", true);
            return;
        }

        const deps = depsText.split('\n').map(d => d.trim()).filter(d => d.length > 0);

        const zip = new JSZip();

        // 1. plugin.json
        const config = {
            name: name,
            description: desc,
            dependencies: deps
        };
        zip.file('plugin.json', JSON.stringify(config, null, 2));

        // 2. Class.ts
        const tsContent = `import { IDawiyPlugin } from "../IDawiyPlugin";
import App from "../../App";

export default class ${className} implements IDawiyPlugin {
    id = "${className}-${Date.now()}"; // Unique ID
    name = "${name}";

    private app: App;

    constructor(app: App) {
        this.app = app;
    }

    onActivate() {
        console.log("${name} activated");
        this.app.showToast("${name} activated!");
    }

    onDeactivate() {
        console.log("${name} deactivated");
    }

    render(container: HTMLElement) {
        container.innerHTML = \`
            <div style="padding: 20px; color: white;">
                <h3>\${this.name}</h3>
                <p>${desc}</p>
                <button id="demo-btn" class="btn btn-primary">Click Me</button>
            </div>
        \`;

        const btn = container.querySelector("#demo-btn");
        if(btn) {
            btn.addEventListener("click", () => {
                alert("Hello from ${name}!");
            });
        }
    }
}
`;
        zip.file(`${className}.ts`, tsContent);

        // Generate zip
        const content = await zip.generateAsync({ type: "blob" });

        // Save
        saveAs(content, `${className}.zip`);

        this.app.showToast(`Plugin ${name} generated!`, false);
        this.hideCreator();
    }

    private async handleFileUpload(file: File) {
        if (file.name.endsWith('.zip')) {
            try {
                const zip = await JSZip.loadAsync(file);
                zip.forEach(async (relativePath, zipEntry) => {
                    if (zipEntry.dir) return; // Ignore directories
                    if (!zipEntry.name.match(/\.(ts|js|json)$/)) return; // Allow .ts, .js, .json inside zip

                    const content = await zipEntry.async("string");
                    // Use relative path from zip root
                    this.app.uploadPlugin(relativePath, content, zipEntry.name);
                });
                this.app.showToast("Msg: ZIP definition loaded started...", false);
            } catch (err) {
                this.app.showToast(`Error reading ZIP file: ${err}`, true);
            }
            return;
        }

        if (!file.name.match(/\.(ts|js|json)$/)) {
            this.app.showToast("Only .ts, .js, .json and .zip files are supported.", true);
            return;
        }

        const reader = new FileReader();
        reader.onload = (event) => {
            const content = event.target?.result as string;
            if (!content) return;
            this.app.uploadPlugin(file.name, content, file.name);
        };
        reader.readAsText(file);
    }

    private filterPlugins(filter: 'all' | 'installed' | 'not-installed') {
        // UI update
        this.view.filterAllBtn.classList.remove('active');
        this.view.filterInstalledBtn.classList.remove('active');
        this.view.filterNotInstalledBtn.classList.remove('active');

        if (filter === 'all') this.view.filterAllBtn.classList.add('active');
        else if (filter === 'installed') this.view.filterInstalledBtn.classList.add('active');
        else if (filter === 'not-installed') this.view.filterNotInstalledBtn.classList.add('active');

        // Hide Creator
        if (this.view.creatorContainer) this.view.creatorContainer.style.display = 'none';
        if (this.view.listContainer) this.view.listContainer.style.display = 'block';
        if (this.view.filterCreatorBtn) this.view.filterCreatorBtn.classList.remove('active');

        this.currentFilter = filter;
        this.refreshPluginManagerList(filter);
    }

    private refreshPluginManagerList(filter: 'all' | 'installed' | 'not-installed') {
        if (!this.view.listContainer) return;
        this.view.listContainer.innerHTML = '';

        // For now, we consider all loaded extensions as "Installed".
        // "Not Installed" would be plugins we know about but aren't loaded (e.g. from a registry we don't have yet).
        // So for now, "Not Installed" will be empty.

        // Define what to show
        let pluginsToShow: IDawiyPlugin[] = [];
        if (filter === 'all' || filter === 'installed') {
            pluginsToShow = this.installedExtensions;
        }

        // If filter is 'not-installed', we show nothing (or a placeholder)
        if (filter === 'not-installed') {
            this.view.listContainer.innerHTML = '<div style="padding: 20px; color: #aaa; text-align: center;">No uninstalled plugins found.</div>';
            return;
        }

        if (pluginsToShow.length === 0) {
            this.view.listContainer.innerHTML = '<div style="padding: 20px; color: #aaa; text-align: center;">No plugins found.</div>';
            return;
        }

        pluginsToShow.forEach(p => {
            const item = document.createElement('div');
            item.className = 'pm-item';
            item.innerHTML = `
                <div class="pm-item-info">
                    <div class="pm-item-name">${p.name}</div>
                    <div class="pm-item-desc">${p.description || 'No description provided.'}</div>
                </div>
                <div class="pm-item-action">
                    <button class="pm-install-btn installed" id="uninstall-btn-${p.id}">Uninstall</button>
                </div>
            `;

            this.view.listContainer.appendChild(item);

            const btn = item.querySelector(`#uninstall-btn-${p.id}`) as HTMLElement;
            if (btn) {
                btn.onclick = () => this.uninstallPlugin(p);
            }
        });
    }

    // Bottom Panel Logic
    public refreshBottomPanel() {
        const listContainer = this.app.hostView.dawiyExtensionList;
        if (!listContainer) return;

        listContainer.innerHTML = '';

        this.installedExtensions.forEach(ext => {
            const item = document.createElement('div');
            item.className = 'dawiy-ext-item';
            if (this.activeExtensionId === ext.id) item.classList.add('active');
            item.textContent = ext.name; // Use full name
            item.title = ext.name;

            item.onclick = () => this.selectExtension(ext.id);

            listContainer.appendChild(item);
        });
    }

    private selectExtension(id: string) {
        if (this.activeExtensionId === id) {
            // Toggle off? - Maybe not for the plugin view, keep it active
            // this.activeExtensionId = null;
        } else {
            // Deactivate previous
            if (this.activeExtensionId) {
                const prev = this.installedExtensions.find(e => e.id === this.activeExtensionId);
                if (prev && prev.onDeactivate) prev.onDeactivate();
            }

            this.activeExtensionId = id;
            const ext = this.installedExtensions.find(e => e.id === id);
            if (ext && ext.onActivate) ext.onActivate();
        }
        this.refreshBottomPanel();
        this.renderExtensionContent();
    }

    private renderExtensionContent() {
        const viewContainer = this.app.hostView.dawiyExtensionView;
        if (!viewContainer) return;

        viewContainer.innerHTML = '';

        if (!this.activeExtensionId) {
            viewContainer.innerHTML = '<div class="dawiy-ext-placeholder">Select an extension</div>';
            return;
        }

        const ext = this.installedExtensions.find(e => e.id === this.activeExtensionId);
        if (ext) {
            try {
                ext.render(viewContainer);
            } catch (e) {
                console.error(`Error rendering plugin ${ext.name}:`, e);
                viewContainer.innerHTML = `<div style="color:red">Error rendering plugin: ${e}</div>`;
            }
        }
    }

    public saveAllUserData() {
        this.installedExtensions.forEach(plugin => {
            if (plugin.getUserData) {
                try {
                    const data = plugin.getUserData();
                    if (data !== undefined) {
                        localStorage.setItem(this.getUserDataKey(plugin.id), JSON.stringify(data));
                    }
                } catch (e) {
                    console.warn(`Failed to save user data for plugin ${plugin.name}`, e);
                }
            }
        });
    }

    public uninstallPlugin(plugin: IDawiyPlugin) {
        if (!confirm(`Are you sure you want to uninstall "${plugin.name}"?\nThis will delete all Global User Data for this plugin.`)) return;

        // 1. Deactivate if active
        if (this.activeExtensionId === plugin.id) {
            this.selectExtension(plugin.id);
        }
        if (plugin.onDeactivate) plugin.onDeactivate();
        if (this.activeExtensionId === plugin.id) {
            this.activeExtensionId = null;
            this.refreshBottomPanel();
            this.renderExtensionContent();
        }

        // 2. Remove from list
        this.installedExtensions = this.installedExtensions.filter(p => p.id !== plugin.id);

        // 3. Clear User Data
        localStorage.removeItem(this.getUserDataKey(plugin.id));

        // 4. Update UI
        this.refreshPluginManagerList(this.currentFilter);
        this.refreshBottomPanel();

        this.app.showToast(`Uninstalled ${plugin.name} and cleared user data.`);
    }

    /**
     * Collects project data from all plugins.
     */
    public getPluginsProjectData(): { [id: string]: any } {
        const data: { [id: string]: any } = {};
        this.installedExtensions.forEach(plugin => {
            if (plugin.getProjectData) {
                try {
                    const pData = plugin.getProjectData();
                    if (pData !== undefined) {
                        data[plugin.id] = pData;
                    }
                } catch (e) {
                    console.warn(`Failed to get project data from plugin ${plugin.name}`, e);
                }
            }
        });
        return data;
    }

    /**
     * Distributes project data to plugins.
     */
    public setPluginsProjectData(data: { [id: string]: any }) {
        if (!data) return;

        for (const [id, pData] of Object.entries(data)) {
            const plugin = this.installedExtensions.find(p => p.id === id);
            if (plugin && plugin.setProjectData) {
                try {
                    plugin.setProjectData(pData);
                } catch (e) {
                    console.warn(`Failed to set project data for plugin ${plugin.name}`, e);
                }
            }
        }
    }
}