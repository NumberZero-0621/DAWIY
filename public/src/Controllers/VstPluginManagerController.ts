import App from "../App";
import VstPluginManagerView from "../Views/VstPluginManagerView";
import SettingsPersistenceController from "./SettingsPersistenceController";
import { DEFAULT_VST3_PATHS } from "./VstPluginController";
import { t } from "../Utils/i18n";

export default class VstPluginManagerController {

    private app: App;
    private view: VstPluginManagerView;

    constructor(app: App) {
        this.app = app;
    }

    public setView(view: VstPluginManagerView) {
        this.view = view;
        this.bindEvents();
    }

    public openWindow() {
        this.refreshUI();
        this.refreshPluginsList();
        this.view.show();
    }

    private bindEvents() {
        this.view.closeBtn.onclick = () => this.view.hide();

        this.view.addPathBtn.onclick = async () => {
            // In a real desktop app, you might want to open a directory picker.
            // For now, we will use a simple prompt.
            const newPath = prompt("Enter a new VST3 search path (e.g. C:\\VstPlugins):");
            if (newPath) {
                const paths = SettingsPersistenceController.get<string[]>("vstPluginPaths", [...DEFAULT_VST3_PATHS]);
                if (!paths.includes(newPath)) {
                    paths.push(newPath);
                    SettingsPersistenceController.save("vstPluginPaths", paths);
                    this.refreshUI();
                }
            }
        };

        this.view.resetPathsBtn.onclick = async () => {
            if (await confirm(t("vst.confirm_reset_paths"))) {
                SettingsPersistenceController.save("vstPluginPaths", [...DEFAULT_VST3_PATHS]);
                this.refreshUI();
            }
        };

        this.view.autoScanSelect.onchange = () => {
            const isAutoScan = this.view.autoScanSelect.value === "true";
            SettingsPersistenceController.save("vstAutoScan", isAutoScan);
        };

        this.view.scanExecuteBtn.onclick = () => {
            this.app.vstPluginController.scanVstPlugins();
        };
    }

    public refreshPluginsList() {
        if (!this.view || !this.view.scannedListContainer) return;
        const container = this.view.scannedListContainer;

        container.innerHTML = '';
        const plugins = this.app.vstPluginController.scannedPlugins || [];

        if (plugins.length === 0) {
            container.innerHTML = `<div style="padding: 10px; color: #888; text-align: center; font-size: 0.9em;">No plugins scanned yet.</div>`;
            return;
        }

        plugins.forEach(plugin => {
            const item = document.createElement('div');
            item.style.display = 'flex';
            item.style.justifyContent = 'space-between';
            item.style.alignItems = 'center';
            item.style.padding = '8px';
            item.style.borderBottom = '1px solid #444';
            item.style.background = '#2a2a2a';
            item.style.marginBottom = '4px';

            const infoDiv = document.createElement('div');
            const nameEl = document.createElement('div');
            nameEl.style.fontWeight = 'bold';
            nameEl.style.color = '#fff';
            nameEl.innerText = plugin.name;

            const pathEl = document.createElement('div');
            pathEl.style.fontSize = '0.8em';
            pathEl.style.color = '#aaa';
            pathEl.style.wordBreak = 'break-all';
            pathEl.innerText = `${plugin.vendor ? `[${plugin.vendor}] ` : ''}${plugin.path}`;

            infoDiv.appendChild(nameEl);
            infoDiv.appendChild(pathEl);

            const actionDiv = document.createElement('div');
            const openBtn = document.createElement('button');
            openBtn.className = 'btn btn-sm btn-primary';
            openBtn.innerText = t("vst.open_plugin");
            openBtn.onclick = () => {
                this.app.vstPluginController.launchVstStandalone(plugin.path);
            };
            actionDiv.appendChild(openBtn);

            item.appendChild(infoDiv);
            item.appendChild(actionDiv);
            container.appendChild(item);
        });
    }

    private refreshUI() {
        if (!this.view) return;

        const paths = SettingsPersistenceController.get<string[]>("vstPluginPaths", [...DEFAULT_VST3_PATHS]);
        const isAutoScan = SettingsPersistenceController.get<boolean>("vstAutoScan", false);

        this.view.autoScanSelect.value = isAutoScan ? "true" : "false";

        this.view.pathsListContainer.innerHTML = '';
        if (paths.length === 0) {
            this.view.pathsListContainer.innerHTML = `<div style="color: #888; text-align: center; padding: 5px;">No custom paths added.</div>`;
        } else {
            paths.forEach((path, index) => {
                const item = document.createElement('div');
                item.style.display = 'flex';
                item.style.justifyContent = 'space-between';
                item.style.alignItems = 'center';
                item.style.padding = '5px';
                item.style.borderBottom = '1px solid #333';

                const pathText = document.createElement('span');
                pathText.style.color = '#ccc';
                pathText.style.fontSize = '0.9em';
                pathText.style.wordBreak = 'break-all';
                pathText.innerText = path;

                const removeBtn = document.createElement('button');
                removeBtn.className = 'btn btn-sm btn-danger';
                removeBtn.innerText = 'X';
                removeBtn.style.padding = '2px 8px';
                removeBtn.onclick = async () => {
                    if (await confirm(t("vst.confirm_delete_path"))) {
                        paths.splice(index, 1);
                        SettingsPersistenceController.save("vstPluginPaths", paths);
                        this.refreshUI();
                    }
                };

                item.appendChild(pathText);
                item.appendChild(removeBtn);
                this.view.pathsListContainer.appendChild(item);
            });
        }
    }
}
