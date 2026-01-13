import App from "../App";
import DawiyPluginView from "../Views/DawiyPluginView";
import { IDawiyPlugin } from "../DawiyPlugins/IDawiyPlugin";

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

    private loadPlugins() {
        // Automatically load all .ts files in ../DawiyPlugins (including subdirectories)
        // @ts-ignore
        const context = require.context('../DawiyPlugins', true, /\.ts$/);

        context.keys().forEach((key: string) => {
            // Exclude non-plugin files
            if (key.includes('IDawiyPlugin') || key.includes('PluginTemplate')) {
                return;
            }

            try {
                const pluginModule = context(key);
                const PluginClass = pluginModule.default;

                if (PluginClass) {
                    const pluginInstance = new PluginClass(this.app);
                    // Simple check if it matches the interface (has 'id', 'name', 'render')
                    if (pluginInstance.id && pluginInstance.name && typeof pluginInstance.render === 'function') {
                        this.installedExtensions.push(pluginInstance);
                    }
                }
            } catch (e) {
                console.error(`Failed to load plugin from ${key}:`, e);
            }
        });
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
            ext.render(viewContainer);
        }
    }
}
