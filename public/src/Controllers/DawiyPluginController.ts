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

export interface PluginFolder {
    id: string;
    name: string;
    type: 'folder';
    items: (string | PluginFolder)[];
    collapsed: boolean;
}

export type PluginLayoutItem = string | PluginFolder;

export default class DawiyPluginController {

    private app: App;
    private view: DawiyPluginView;

    // Extensions list
    private installedExtensions: IDawiyPlugin[];
    private pluginGroups: Map<string, string> = new Map(); // Store group per plugin ID

    private pluginLayout: PluginLayoutItem[] = [];
    private LAYOUT_STORAGE_KEY = 'dawiy_plugin_layout';

    private activeExtensionId: string | null = null;
    private currentFilter: 'all' | 'installed' | 'not-installed' = 'all';
    private popOutWindow: Window | null = null;

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
                            if (!this.installedExtensions.find(ext => ext.id === instance.id)) {
                                this.installedExtensions.push(instance);
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

                                // Extract Group
                                // key is like "./C5thPlugin/C5thPlugin.ts" or "./Plugin.ts"
                                const parts = key.split('/');
                                let group = 'General';
                                if (parts.length > 2) {
                                    // ./Dir/File.ts -> parts[1] is Dir
                                    group = parts[1];
                                }
                                this.pluginGroups.set(instance.id, group);
                            }
                        }
                    }
                } catch (err) {
                    console.warn(`Failed to load plugin from ${key}:`, err);
                }
            });

            console.log(`Loaded ${this.installedExtensions.length} DAWIY plugins.`);

            this.loadLayout();
            this.reconcileLayout();

        } catch (e) {
            console.error("Error loading plugins automatically:", e);
        }
    }

    private loadLayout() {
        try {
            const stored = localStorage.getItem(this.LAYOUT_STORAGE_KEY);
            if (stored) {
                this.pluginLayout = JSON.parse(stored);
            } else {
                this.pluginLayout = [];
            }
        } catch (e) {
            console.warn("Failed to load plugin layout", e);
            this.pluginLayout = [];
        }
    }

    private saveLayout() {
        localStorage.setItem(this.LAYOUT_STORAGE_KEY, JSON.stringify(this.pluginLayout));
    }

    private reconcileLayout() {
        // 1. Get all installed IDs
        const installedIds = new Set(this.installedExtensions.map(e => e.id));

        // 2. Traverse layout, remove invalid IDs, check which IDs are present
        const presentIds = new Set<string>();

        const traverse = (items: PluginLayoutItem[]): PluginLayoutItem[] => {
            const cleanItems: PluginLayoutItem[] = [];
            for (const item of items) {
                if (typeof item === 'string') {
                    if (installedIds.has(item)) {
                        cleanItems.push(item);
                        presentIds.add(item);
                    }
                } else {
                    // Folder
                    item.items = traverse(item.items);
                    cleanItems.push(item);
                }
            }
            return cleanItems;
        };

        this.pluginLayout = traverse(this.pluginLayout);

        // 3. Add missing IDs to root
        this.installedExtensions.forEach(ext => {
            if (!presentIds.has(ext.id)) {
                this.pluginLayout.push(ext.id);
            }
        });

        this.saveLayout();
    }

    public createFolder(name: string) {
        const folder: PluginFolder = {
            id: `folder_${Date.now()}`,
            name: name,
            type: 'folder',
            items: [],
            collapsed: false
        };
        this.pluginLayout.push(folder);
        this.saveLayout();
        this.refreshBottomPanel();
    }

    public toggleFolder(folderId: string) {
        const findAndToggle = (items: PluginLayoutItem[]): boolean => {
            for (const item of items) {
                if (typeof item !== 'string' && item.id === folderId) {
                    item.collapsed = !item.collapsed;
                    return true;
                }
                if (typeof item !== 'string') {
                    if (findAndToggle(item.items)) return true;
                }
            }
            return false;
        };
        if (findAndToggle(this.pluginLayout)) {
            this.saveLayout();
            this.refreshBottomPanel();
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

        if (this.view.popOutBtn) {
            this.view.popOutBtn.onclick = () => this.togglePopOut();
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
        const addFolderBtn = document.getElementById('dawiy-add-folder-btn');
        if (addFolderBtn) {
            addFolderBtn.onclick = () => {
                const name = prompt("Folder Name:");
                if (name) this.createFolder(name);
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
        const listContent = document.getElementById('dawiy-list-content');
        if (!listContent) return;
        listContent.innerHTML = ''; // クリア

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

        // Grouping
        const groups: { [group: string]: IDawiyPlugin[] } = {};
        pluginsToShow.forEach(p => {
            const group = this.pluginGroups.get(p.id) || 'General';
            if (!groups[group]) groups[group] = [];
            groups[group].push(p);
        });

        // Sort groups (General first, then alphabetical)
        const groupNames = Object.keys(groups).sort((a, b) => {
            if (a === 'General') return -1;
            if (b === 'General') return 1;
            return a.localeCompare(b);
        });

        groupNames.forEach(groupName => {
            const groupContainer = document.createElement('div');
            groupContainer.className = 'pm-group';

            const header = document.createElement('h3');
            header.className = 'pm-group-header';
            header.textContent = groupName;
            header.style.marginTop = '10px';
            header.style.marginBottom = '5px';
            header.style.color = '#ddd';
            header.style.borderBottom = '1px solid #444';
            header.style.paddingBottom = '5px';
            groupContainer.appendChild(header);

            groups[groupName].forEach(p => {
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
                groupContainer.appendChild(item);

                // Re-select after append to attach event
                // Note: querySelector on groupContainer works before appending to listContainer? Yes.
            });

            this.view.listContainer.appendChild(groupContainer);

            // Bind events for this group's items
            groups[groupName].forEach(p => {
                const btn = groupContainer.querySelector(`#uninstall-btn-${p.id}`) as HTMLElement;
                if (btn) {
                    btn.onclick = () => this.uninstallPlugin(p);
                }
            });
        });
        const rootDrop = document.createElement('div');
        rootDrop.style.height = '20px';
        rootDrop.style.flexGrow = '1';
        this.setupDropTarget(rootDrop, null, 'root');
        listContent.appendChild(rootDrop);
    }

    public refreshBottomPanel() {
        const listContainer = this.app.hostView.dawiyExtensionList;
        if (!listContainer) return;

        // Ensure scrolling
        listContainer.style.overflowY = 'auto';
        listContainer.style.height = '100%'; // Ensure it fills parent to allow scrolling


        listContainer.innerHTML = '';

        // Add "New Folder" button at the top
        const toolbar = document.createElement('div');
        toolbar.style.padding = '5px';
        toolbar.style.borderBottom = '1px solid #444';
        toolbar.style.marginBottom = '5px';
        toolbar.style.display = 'flex';
        toolbar.style.justifyContent = 'flex-end';
        toolbar.style.position = 'sticky'; // Make toolbar sticky? Maybe not for now.
        toolbar.style.top = '0';
        toolbar.style.background = '#222'; // Match bg if sticky
        toolbar.style.zIndex = '10';

        const addFolderBtn = document.createElement('button');
        addFolderBtn.innerHTML = '<i class="bi bi-folder-plus"></i>';
        addFolderBtn.className = 'btn btn-sm btn-outline-secondary';
        addFolderBtn.title = 'Create New Folder';
        addFolderBtn.onclick = () => {
            const name = prompt("Folder Name:");
            if (name) this.createFolder(name);
        };
        toolbar.appendChild(addFolderBtn);
        listContainer.appendChild(toolbar);

        const renderItems = (items: PluginLayoutItem[], container: HTMLElement, level: number) => {
            items.forEach(item => {
                if (typeof item === 'string') {
                    // It's a plugin ID
                    const ext = this.installedExtensions.find(e => e.id === item);
                    if (!ext) return;

                    const el = document.createElement('div');
                    el.className = 'dawiy-ext-item';
                    el.style.paddingLeft = `${level * 15 + 10}px`;
                    if (this.activeExtensionId === ext.id) el.classList.add('active');
                    el.textContent = ext.name;
                    el.title = ext.name;
                    el.draggable = true;

                    el.onclick = () => this.selectExtension(ext.id);
                    el.ondragstart = (e) => this.handleDragStart(e, item, 'plugin');

                    // Drop target logic (to reorder) could go here
                    this.setupDropTarget(el, item, 'plugin');

                    container.appendChild(el);
                } else {
                    // It's a folder
                    const folderDiv = document.createElement('div');
                    folderDiv.className = 'dawiy-ext-folder';

                    // Folder Header
                    const header = document.createElement('div');
                    header.className = 'dawiy-ext-folder-header';
                    header.style.paddingLeft = `${level * 15 + 5}px`;
                    header.style.cursor = 'pointer';
                    header.style.display = 'flex';
                    header.style.alignItems = 'center';
                    header.draggable = true;
                    header.innerHTML = `
                        <i class="bi ${item.collapsed ? 'bi-chevron-right' : 'bi-chevron-down'}" style="margin-right: 5px; font-size: 10px;"></i>
                        <i class="bi bi-folder${item.collapsed ? '' : '2-open'}" style="margin-right: 5px;"></i>
                        <span style="color: white;">${item.name}</span>
                    `;

                    header.onclick = (e) => {
                        e.stopPropagation();
                        this.toggleFolder(item.id);
                    };
                    header.ondragstart = (e) => this.handleDragStart(e, item.id, 'folder');
                    this.setupDropTarget(header, item.id, 'folder');

                    folderDiv.appendChild(header);

                    // Folder Content
                    if (!item.collapsed) {
                        const contentDiv = document.createElement('div');
                        renderItems(item.items, contentDiv, level + 1);
                        folderDiv.appendChild(contentDiv);

                        // Empty folder drop zone
                        if (item.items.length === 0) {
                            const emptyZone = document.createElement('div');
                            emptyZone.style.height = '20px'; // Hit area
                            emptyZone.style.marginLeft = `${(level + 1) * 15}px`;
                            // emptyZone.style.border = '1px dashed #555';
                            this.setupDropTarget(emptyZone, item.id, 'folder-content');
                            folderDiv.appendChild(emptyZone);
                        } else {
                            // A drop zone at the end of the folder to append
                            const appendZone = document.createElement('div');
                            appendZone.style.height = '10px';
                            this.setupDropTarget(appendZone, item.id, 'folder-append');
                            folderDiv.appendChild(appendZone);
                        }
                    }

                    container.appendChild(folderDiv);
                }
            });
        };

        renderItems(this.pluginLayout, listContainer, 0);

        // Root drop zone
        const rootDrop = document.createElement('div');
        rootDrop.style.height = '20px';
        rootDrop.style.flexGrow = '1';
        this.setupDropTarget(rootDrop, null, 'root');
        listContainer.appendChild(rootDrop);
    }

    private draggingItem: { id: string, type: 'plugin' | 'folder' } | null = null;

    private handleDragStart(e: DragEvent, id: string, type: 'plugin' | 'folder') {
        this.draggingItem = { id, type };
        e.dataTransfer?.setData('text/plain', JSON.stringify({ id, type }));
        e.stopPropagation();
    }

    private setupDropTarget(el: HTMLElement, targetId: string | null, type: 'plugin' | 'folder' | 'folder-content' | 'folder-append' | 'root') {
        el.ondragover = (e) => {
            e.preventDefault();
            e.stopPropagation();
            el.style.background = 'rgba(255,255,255,0.1)';
            el.style.borderTop = '2px solid #007bff';
        };
        el.ondragleave = (e) => {
            e.preventDefault();
            e.stopPropagation();
            el.style.background = '';
            el.style.borderTop = '';
        };
        el.ondrop = (e) => {
            e.preventDefault();
            e.stopPropagation();
            el.style.background = '';
            el.style.borderTop = '';

            if (this.draggingItem) {
                this.handleDrop(this.draggingItem.id, targetId, type);
            }
            this.draggingItem = null;
        };
    }

    private handleDrop(draggedId: string, targetId: string | null, targetType: string) {
        if (draggedId === targetId) return;

        // Check for circular dependency
        if (this.isDescendant(draggedId, targetId)) {
            console.warn("Cannot move a folder into its own child.");
            this.app.showToast("Cannot move a folder into its own child.", true);
            return;
        }

        // 1. Remove
        let draggedItem: PluginLayoutItem | null = null;
        const remove = (items: PluginLayoutItem[]): boolean => {
            for (let i = 0; i < items.length; i++) {
                const item = items[i];
                if (typeof item === 'string') {
                    if (item === draggedId) {
                        draggedItem = item;
                        items.splice(i, 1);
                        return true;
                    }
                } else {
                    if (item.id === draggedId) {
                        draggedItem = item;
                        items.splice(i, 1);
                        return true;
                    }
                    if (remove(item.items)) return true;
                }
            }
            return false;
        };

        if (!remove(this.pluginLayout)) return;
        if (!draggedItem) return;

        // 2. Insert
        const insert = (items: PluginLayoutItem[], target: string | null, type: string): boolean => {
            if (type === 'root') {
                items.push(draggedItem!);
                return true;
            }

            // If target is folder-append or folder-content, we find the folder (targetId) and push
            if (type === 'folder-append' || type === 'folder-content') {
                const findFolder = (list: PluginLayoutItem[]) => {
                    for (const i of list) {
                        if (typeof i !== 'string' && i.id === target) {
                            i.items.push(draggedItem!);
                            return true;
                        }
                        if (typeof i !== 'string') {
                            if (findFolder(i.items)) return true;
                        }
                    }
                    return false;
                };
                return findFolder(this.pluginLayout);
            }

            // If target is plugin/folder, we find it and insert before it
            for (let i = 0; i < items.length; i++) {
                const item = items[i];
                const id = typeof item === 'string' ? item : item.id;
                if (id === target) {
                    items.splice(i, 0, draggedItem!);
                    return true;
                }
                if (typeof item !== 'string') {
                    if (insert(item.items, target, type)) return true;
                }
            }
            return false;
        };

        let inserted = false;
        if (targetId === null && targetType === 'root') {
            this.pluginLayout.push(draggedItem);
            inserted = true;
        } else {
            inserted = insert(this.pluginLayout, targetId, targetType);
        }

        if (!inserted) {
            // Restore to root if valid insert failed
            this.pluginLayout.push(draggedItem);
            this.app.showToast("Invalid move. Item restored to root.", true);
        }

        this.saveLayout();
        this.refreshBottomPanel();
    }

    private isDescendant(parentId: string, childId: string | null): boolean {
        if (!childId) return false;

        const findFolder = (items: PluginLayoutItem[]): PluginFolder | undefined => {
            for (const item of items) {
                if (typeof item !== 'string') {
                    if (item.id === parentId) return item;
                    const found = findFolder(item.items);
                    if (found) return found;
                }
            }
            return undefined;
        };

        const parent = findFolder(this.pluginLayout);
        if (!parent) return false;

        const checkChildren = (items: PluginLayoutItem[]): boolean => {
            for (const item of items) {
                if (typeof item === 'string') {
                    if (item === childId) return true;
                } else {
                    if (item.id === childId) return true;
                    if (checkChildren(item.items)) return true;
                }
            }
            return false;
        };
        return checkChildren(parent.items);
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

        // Update Title
        const ext = this.installedExtensions.find(e => e.id === this.activeExtensionId);
        if (this.view.pluginTitle && ext) {
            this.view.pluginTitle.textContent = ext.name;
        } else if (this.view.pluginTitle) {
            this.view.pluginTitle.textContent = "Plugin";
        }

        this.refreshBottomPanel();

        if (this.popOutWindow && !this.popOutWindow.closed) {
            this.renderExtensionInPopOut();
            // Update main view placeholder
            const viewContainer = this.app.hostView.dawiyExtensionView;
            if (viewContainer) {
                viewContainer.innerHTML = '<div class="dawiy-ext-placeholder">Opened in external window</div>';
            }
        } else {
            this.renderExtensionContent();
        }
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

    private togglePopOut() {
        if (this.popOutWindow && !this.popOutWindow.closed) {
            this.popOutWindow.close();
        } else {
            this.openPopOut();
        }
    }

    private openPopOut() {
        if (!this.activeExtensionId) return;

        this.popOutWindow = window.open("", "_blank", "width=800,height=600");
        if (!this.popOutWindow) {
            this.app.showToast("Pop-up blocked? Please allow.", true);
            return;
        }

        // Copy styles
        const head = this.popOutWindow.document.head;
        document.querySelectorAll('link[rel="stylesheet"]').forEach((link) => {
            const newLink = this.popOutWindow!.document.createElement('link');
            newLink.rel = 'stylesheet';
            newLink.href = (link as HTMLLinkElement).href;
            head.appendChild(newLink);
        });
        document.querySelectorAll('style').forEach((style) => {
            const newStyle = this.popOutWindow!.document.createElement('style');
            newStyle.textContent = style.textContent;
            head.appendChild(newStyle);
        });

        // Basic Body Style
        const style = this.popOutWindow.document.createElement('style');
        style.textContent = `
            body { 
                background-color: #222; 
                color: #eee; 
                margin: 0; 
                padding: 10px; 
                overflow: auto; 
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
            }
        `;
        head.appendChild(style);

        this.popOutWindow.document.title = "DAWIY Plugin";

        // Render
        this.renderExtensionInPopOut();

        // Update Main View
        const viewContainer = this.app.hostView.dawiyExtensionView;
        if (viewContainer) {
            viewContainer.innerHTML = '<div class="dawiy-ext-placeholder">Opened in external window</div>';
        }

        // Handle Close
        this.popOutWindow.onbeforeunload = () => {
            this.popOutWindow = null;
            // Restore if still active
            if (this.activeExtensionId) {
                this.renderExtensionContent();
            }
        };
    }

    private renderExtensionInPopOut() {
        if (!this.popOutWindow || this.popOutWindow.closed) return;
        if (!this.activeExtensionId) return;

        const ext = this.installedExtensions.find(e => e.id === this.activeExtensionId);
        if (!ext) return;

        this.popOutWindow.document.title = `DAWIY - ${ext.name}`;

        // Clear body
        this.popOutWindow.document.body.innerHTML = '';

        const container = this.popOutWindow.document.createElement('div');
        this.popOutWindow.document.body.appendChild(container);

        try {
            ext.render(container);
        } catch (e) {
            console.error(`Error rendering plugin ${ext.name} in popout:`, e);
            container.innerHTML = `<div style="color:red">Error rendering plugin: ${e}</div>`;
        }
    }
}