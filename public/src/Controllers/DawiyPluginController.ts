import App from "../App";
import DawiyPluginView from "../Views/DawiyPluginView";
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

    constructor(app: App) {
        this.app = app;
        this.installedExtensions = [];
        this.loadPlugins();
    }

    /**
     * Automatically loads plugins from the ../DawiyPlugins directory.
     */
    private loadPlugins() {
        try {
            // Automatically load all .ts files in ../DawiyPlugins (including subdirectories)
            // @ts-ignore
            const context = require.context('../DawiyPlugins', true, /\.ts$/);

            context.keys().forEach((key: string) => {
                // Ignore non-plugin files
                if (key.includes('IDawiyPlugin') ||
                    key.includes('README') ||
                    key.includes('.d.ts') ||
                    key.includes('PluginTemplate')) {
                    return;
                }

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

    public setView(view: DawiyPluginView) {
        this.view = view;
        this.bindEvents();
        this.refreshBottomPanel(); // Initialize bottom panel
    }

    public openWindow() {
        this.view.show();
    }

    private bindEvents() {
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
    }

    private handleFileUpload(file: File) {
        if (!file.name.endsWith('.ts')) {
            this.app.showToast("Only .ts files are supported.", true);
            return;
        }

        const reader = new FileReader();
        reader.onload = (event) => {
            const content = event.target?.result as string;
            if (!content) return;

            if (content.includes('IDawiyPlugin') || content.includes('implements IDawiyPlugin')) {
                fetch('/upload-plugin', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'text/plain',
                        'x-filename': file.name
                    },
                    body: content
                })
                    .then(response => {
                        if (response.ok) {
                            this.app.showToast(`Plugin "${file.name}" installed! App will reload shortly.`);
                        } else if (response.status === 409) {
                            this.app.showToast(`同名のプラグインが既にインストールされています: "${file.name}"`, true);
                        } else {
                            this.app.showToast(`Failed to install plugin: ${response.statusText}`, true);
                        }
                    })
                    .catch(err => {
                        this.app.showToast(`Error uploading plugin: ${err}`, true);
                    });
            } else {
                this.app.showToast("Invalid plugin file. Must implement IDawiyPlugin.", true);
            }
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

        // Logic to filter list (TODO)
        console.log("Filter selected:", filter);
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
}