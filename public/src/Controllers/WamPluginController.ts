import App from "../App";
import WamPluginView from "../Views/WamPluginView";
import { t } from "../Utils/i18n";
import { BACKEND_URL } from "../Env";

export interface WamPluginInfo {
    name: string;
    url: string;
    description?: string;
    thumbnail?: string;
    vendor?: string;
}

export default class WamPluginController {

    private app: App;
    private view: WamPluginView;

    private installedWams: WamPluginInfo[] = [];
    private availableWams: WamPluginInfo[] = [
        // Local "Bank" Plugins
        { name: "BigMuff", url: `${BACKEND_URL}/plugins/BigMuff/index.js`, vendor: "Local Bank" },
        { name: "Compressor Guitarix", url: `${BACKEND_URL}/plugins/CompressorGuitarix/index.js`, vendor: "Local Bank" },
        { name: "Dual Pitch Shifter", url: `${BACKEND_URL}/plugins/DualPitchShifter/index.js`, vendor: "Local Bank" },
        { name: "Guitar Amp Sim 60s", url: `${BACKEND_URL}/plugins/GuitarAmpSim60s/index.js`, vendor: "Local Bank" },
        { name: "JUNO-6 v2", url: `${BACKEND_URL}/plugins/JUNO6v2/index.js`, vendor: "Local Bank" },
        { name: "Kpp Fuzz", url: `${BACKEND_URL}/plugins/Kpp_fuzz/index.js`, vendor: "Local Bank" },
        { name: "Octaver", url: `${BACKEND_URL}/plugins/Octaver/index.js`, vendor: "Local Bank" },
        { name: "OscTube", url: `${BACKEND_URL}/plugins/OscTube/index.js`, vendor: "Local Bank" },
        { name: "Overdrive Rix", url: `${BACKEND_URL}/plugins/OverdriveRix/index.js`, vendor: "Local Bank" },
        { name: "Owl Dirty", url: `${BACKEND_URL}/plugins/OwlDirty/index.js`, vendor: "Local Bank" },
        { name: "Owl Shimmer", url: `${BACKEND_URL}/plugins/OwlShimmer/index.js`, vendor: "Local Bank" },
        { name: "Pro54", url: `${BACKEND_URL}/plugins/Pro54/index.js`, vendor: "Local Bank" },
        { name: "Smooth Delay", url: `${BACKEND_URL}/plugins/SmoothDelay/index.js`, vendor: "Local Bank" },
        { name: "Stereo Freq Shifter", url: `${BACKEND_URL}/plugins/StereoFreqShifter/index.js`, vendor: "Local Bank" },
        { name: "Stone Phaser Stereo", url: `${BACKEND_URL}/plugins/StonePhaserStereo/index.js`, vendor: "Local Bank" },
        { name: "TS9 Overdrive", url: `${BACKEND_URL}/plugins/TS9_OverdriveFaustGenerated/index.js`, vendor: "Local Bank" },
        { name: "Thru Zero Flanger", url: `${BACKEND_URL}/plugins/ThruZeroFlanger/index.js`, vendor: "Local Bank" },
        { name: "Weird Phaser", url: `${BACKEND_URL}/plugins/WeirdPhaser/index.js`, vendor: "Local Bank" },
        { name: "Blipper", url: `${BACKEND_URL}/plugins/blipper/index.js`, vendor: "Local Bank" },
        { name: "Deathgate", url: `${BACKEND_URL}/plugins/deathgate/index.js`, vendor: "Local Bank" },
        { name: "Disto Machine", url: `${BACKEND_URL}/plugins/disto_machine/index.js`, vendor: "Local Bank" },
        { name: "Graphic Equalizer", url: `${BACKEND_URL}/plugins/graphicEqualizer/index.js`, vendor: "Local Bank" },
        { name: "Greyhole", url: `${BACKEND_URL}/plugins/greyhole/index.js`, vendor: "Local Bank" },
        { name: "Kbverb", url: `${BACKEND_URL}/plugins/kbverb/index.js`, vendor: "Local Bank" },
        { name: "Kpp Distorder", url: `${BACKEND_URL}/plugins/kppdistorder/index.js`, vendor: "Local Bank" },
        { name: "Stone Phaser", url: `${BACKEND_URL}/plugins/stonephaser/index.js`, vendor: "Local Bank" },
        { name: "Sweet Wah", url: `${BACKEND_URL}/plugins/sweetWah/index.js`, vendor: "Local Bank" },
        { name: "Temper", url: `${BACKEND_URL}/plugins/temper/index.js`, vendor: "Local Bank" },

        // Remote/Standard Plugins
        { name: "Clarinet MIDI", url: "https://mainline.i3s.unice.fr/PedalEditor/Back-End/functional-pedals/published/clarinetMIDI/indexGUIStandard.js", vendor: "PedalEditor" },
        { name: "Flute", url: "https://mainline.i3s.unice.fr/PedalEditor/Back-End/functional-pedals/published/fluteForIS2/index.js", vendor: "PedalEditor" },
        { name: "Faust PingPongDelay", url: "https://mainline.i3s.unice.fr/wam2/packages/faustPingPongDelay/plugin/index.js", vendor: "Faust" },
        { name: "OB-Xd", url: "https://mainline.i3s.unice.fr/wam2/packages/obxd/index.js", vendor: "WamExample" },
        { name: "Quadrafuzz", url: "https://mainline.i3s.unice.fr/wam2/packages/quadrafuzz/dist/index.js", vendor: "WamExample" },

        // Burns Audio
        { name: "Distortion (Burns)", url: "https://www.webaudiomodules.com/community/plugins/burns-audio/distortion/index.js", vendor: "Burns Audio" },
        { name: "Drum Sampler (Burns)", url: "https://www.webaudiomodules.com/community/plugins/burns-audio/drumsampler/index.js", vendor: "Burns Audio" },
        { name: "Soundfont (Burns)", url: "https://www.webaudiomodules.com/community/plugins/burns-audio/soundfont/index.js", vendor: "Burns Audio" },
        { name: "Synth 101 (Burns)", url: "https://www.webaudiomodules.com/community/plugins/burns-audio/synth101/index.js", vendor: "Burns Audio" },
    ];

    private STORAGE_KEY = 'wam_plugin_installed_urls';
    private currentFilter: 'installed' | 'available' = 'installed';

    constructor(app: App) {
        this.app = app;
        this.loadInstalledWams();
    }

    public setView(view: WamPluginView) {
        this.view = view;
        this.bindEvents();
    }

    private loadInstalledWams() {
        // Load from localStorage
        try {
            const stored = localStorage.getItem(this.STORAGE_KEY);
            if (stored) {
                const parsed = JSON.parse(stored) as WamPluginInfo[];
                // 過去に保存されたVST履歴（vst://～）が存在する場合は除外して保存し直す
                this.installedWams = parsed.filter(w => !w.url.startsWith("vst://"));
                if (this.installedWams.length !== parsed.length) {
                    this.saveInstalledWams();
                }
            } else {
                this.installedWams = [];
            }
        } catch (e) {
            console.warn("Failed to load installed WAMs", e);
            this.installedWams = [];
        }

        // Auto-install "Local Bank" plugins if they aren't installed yet
        // This ensures built-in plugins appear in "Installed" list by default
        this.availableWams.forEach(wam => {
            if (wam.vendor === "Local Bank") {
                if (!this.installedWams.some(i => i.url === wam.url)) {
                    this.installedWams.push(wam);
                }
            }
        });

        // Ensure "plugins" exists in PluginsController list for runtime usage
        this.syncWithPluginsController();

        this.refreshList();
    }

    private syncWithPluginsController() {
        // This ensures that any plugin in our installed list is actually registered in the runtime controller
        /* 
        // User requested to hide these from the main "Add Plugin" list for now.
        // Only Pedalboard2 should be there.
        if (this.app.pluginsController) {
            this.installedWams.forEach(wam => {
                this.app.pluginsController.addWam(wam.url, wam.name);
            });
        }
        */
    }

    private saveInstalledWams() {
        localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this.installedWams));
    }

    public openWindow() {
        this.view.show();
        this.refreshList();
    }

    public addAvailableWam(wam: WamPluginInfo) {
        if (!this.availableWams.some(w => w.url === wam.url)) {
            this.availableWams.push(wam);
            // If the view is open, refresh the list to show the new plugin immediately
            this.refreshList();
        }
    }

    private bindEvents() {
        this.view.closeBtn.onclick = () => this.view.hide();

        this.view.filterInstalledBtn.onclick = () => {
            this.currentFilter = 'installed';
            this.refreshUI();
        };

        this.view.filterAvailableBtn.onclick = () => {
            this.currentFilter = 'available';
            this.refreshUI();
        };

        this.view.importUrlBtn.onclick = () => {
            const url = this.view.importUrlInput.value.trim();
            if (url) {
                this.installWam({
                    name: "Custom WAM",
                    url: url,
                    description: "Manually imported"
                });
                this.view.importUrlInput.value = "";
            }
        };
    }

    private refreshUI() {
        // Toggle Active State
        this.view.filterInstalledBtn.classList.remove('active');
        this.view.filterAvailableBtn.classList.remove('active');

        if (this.currentFilter === 'installed') this.view.filterInstalledBtn.classList.add('active');
        else this.view.filterAvailableBtn.classList.add('active');

        this.refreshList();
    }

    private refreshList() {
        if (!this.view) return;
        const container = this.view.listContainer;
        if (!container) return;

        container.innerHTML = '';

        const list = this.currentFilter === 'installed' ? this.installedWams : this.availableWams;

        if (list.length === 0) {
            container.innerHTML = `<div style="padding: 20px; color: #aaa; text-align: center;">${t("plugin.wam.no_plugins")}</div>`;
            return;
        }

        list.forEach(wam => {
            const item = document.createElement('div');
            item.className = 'pm-item'; // Reuse existing class for basic styling if global, otherwise duplicate styles
            item.style.display = 'flex';
            item.style.justifyContent = 'space-between';
            item.style.alignItems = 'center';
            item.style.padding = '10px';
            item.style.borderBottom = '1px solid #444';
            item.style.background = '#2a2a2a';
            item.style.marginBottom = '5px';

            // Check if installed (to show status in 'available' tab)
            const isInstalled = this.installedWams.some(i => i.url === wam.url);

            let actionBtn = '';
            if (this.currentFilter === 'installed') {
                actionBtn = `<button class="btn btn-sm btn-danger uninstall-btn" data-url="${wam.url}">${t("plugin.action.uninstall")}</button>`;
            } else {
                if (isInstalled) {
                    actionBtn = `<span style="color: #5cb85c; margin-right: 10px;">${t("plugin.status.installed")}</span>`;
                } else {
                    actionBtn = `<button class="btn btn-sm btn-primary install-btn" data-url="${wam.url}">${t("plugin.action.install")}</button>`;
                }
            }

            item.innerHTML = `
                <div class="pm-item-info">
                    <div class="pm-item-name" style="font-weight: bold; color: #fff;">${wam.name}</div>
                    <div class="pm-item-desc" style="font-size: 0.85em; color: #aaa;">
                        ${wam.vendor ? `[${wam.vendor}] ` : ''}${wam.description || wam.url}
                    </div>
                </div>
                <div class="pm-item-action">
                    ${actionBtn}
                </div>
            `;

            container.appendChild(item);
        });

        // Bind buttons
        container.querySelectorAll('.install-btn').forEach(btn => {
            (btn as HTMLButtonElement).onclick = (e) => {
                const url = (e.target as HTMLElement).getAttribute('data-url');
                const wam = this.availableWams.find(w => w.url === url);
                if (wam) this.installWam(wam);
            };
        });



        container.querySelectorAll('.uninstall-btn').forEach(btn => {
            (btn as HTMLButtonElement).onclick = (e) => {
                const url = (e.target as HTMLElement).getAttribute('data-url');
                if (url) this.uninstallWam(url);
            };
        });
    }

    private installWam(wam: WamPluginInfo) {
        if (this.installedWams.some(i => i.url === wam.url)) {
            this.app.showToast(t("plugin.wam.already_installed"), true);
            return;
        }
        this.installedWams.push(wam);
        this.saveInstalledWams();
        this.app.showToast(t("plugin.wam.installed_message").replace("{0}", wam.name), false);

        // Register to PluginsController to make it available immediately?
        // Ideally, PluginsController needs to know about these.
        // For now, let's just save. The PluginsController might need to read this list on init or be updated.
        // We will assume for this task we just manage the list, and a reload might be needed or we update PluginsController.
        this.app.pluginsController.addWam(wam.url, wam.name);

        this.refreshList();
    }

    private async uninstallWam(url: string) {
        if (await confirm(t("plugin.wam.uninstall_confirm"))) {
            this.installedWams = this.installedWams.filter(w => w.url !== url);
            this.saveInstalledWams();
            this.app.showToast(t("plugin.wam.uninstalled_message"), false);

            // Remove from PluginsController if possible
            this.app.pluginsController.removeWam(url);

            this.refreshList();
        }
    }
}
