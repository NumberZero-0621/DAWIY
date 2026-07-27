import 'bootstrap';
import 'bootstrap/dist/css/bootstrap.min.css';
import App from './App';
import { BACKEND_URL } from './Env';
import AppEventBridge from './Utils/AppEventBridge';
import BPF from './Components/BPF';
import AutomationTrackElement from './Components/Editor/AutomationTrackElement';
import ExportProjectElement from "./Components/Project/ExportProjectElement";
import LoadProjectElement from "./Components/Project/LoadProjectElement";
import LoginElement from "./Components/Project/LoginElement";
import SaveProjectElement from "./Components/Project/SaveProjectElement";
import ScrollBarElement from "./Components/ScrollBarElement";
import ConfirmElement from "./Components/Utils/ConfirmElement";
import DialogElement from "./Components/Utils/DialogElement";
import PlaceholderElement from "./Components/Utils/PlaceholderElement";

//setupCustomElementsDefine()

customElements.define(
    "bpf-automation",
    BPF
);
customElements.define(
    "save-project-element",
    SaveProjectElement
);
customElements.define(
    "load-project-element",
    LoadProjectElement
);
customElements.define(
    "login-element",
    LoginElement
);
customElements.define(
    "confirm-element",
    ConfirmElement
);
customElements.define(
    "dialog-element",
    DialogElement
);
customElements.define(
    "placeholder-element",
    PlaceholderElement
);
customElements.define(
    "scrollbar-element",
    ScrollBarElement
);
customElements.define(
    "export-project-element",
    ExportProjectElement
);
customElements.define(
    "automation-track-element",
    AutomationTrackElement
);


import TemplateLoader from './TemplateLoader';

import { updateDOM, setLanguage, Language } from './Utils/i18n';
import SettingsPersistenceController from './Controllers/SettingsPersistenceController';

// ... imports

import { invoke } from '@tauri-apps/api/core';

window.addEventListener('beforeunload', (e) => {
    e.returnValue = 'test';
});

window.addEventListener('unload', () => {
    // ページ遷移・リロードが確定した段階ですべてのVSTウインドウおよびポップアウトを強制クローズする
    if ((window as any).__TAURI__ || (window as any).__TAURI_INTERNALS__) {
        if (!new URLSearchParams(window.location.search).get('popout')) {
            invoke('close_all_vst_editors').catch(console.error);
            import('@tauri-apps/api/webviewWindow').then(({ WebviewWindow }) => {
                WebviewWindow.getAll().then(wins => wins.forEach(w => {
                    if (w.label.startsWith('dawiy-popout-')) w.close();
                }));
            }).catch(() => {});
        }
    }
});

const audioCtx = new AudioContext({ latencyHint: 0.00001 });
TemplateLoader.load();
// updateDOM(); // Moved to inside init
let app: App;

(async () => {
    const showLoading = () => {
        // Find the loading overlay and display it
        const loadingOverlay = document.querySelector('.loading-overlay');
        if (loadingOverlay) {
            (loadingOverlay as HTMLElement).style.display = 'flex';
            document.body.classList.add('loading'); // This class is added to blur the content behind the overlay
        }
    }

    const hideLoading = () => {
        // Find the loading overlay and hide it
        const loadingOverlay = document.querySelector('.loading-overlay');
        if (loadingOverlay) {
            (loadingOverlay as HTMLElement).style.display = 'none';
            document.body.classList.remove('loading'); // Remove the class to un-blur the content
        }
    }

    showLoading();

    // 1. Initialize Settings Persistence
    await SettingsPersistenceController.init();

    // 2. Set Language (this updates DOM)
    const lang = SettingsPersistenceController.get<Language>("language", "en");
    setLanguage(lang);

    // 3. Check for Popout Mode
    const params = new URLSearchParams(window.location.search);
    const popoutExtId = params.get('popout');

    if (popoutExtId) {
        document.body.classList.add('popout-mode');
        const menuBar = document.getElementById('menu-bar');
        if (menuBar) menuBar.style.display = 'none';
        const appDiv = document.getElementById('app');
        if (appDiv) appDiv.style.display = 'none';
        const loadingOverlay = document.querySelector('.loading-overlay');
        if (loadingOverlay) (loadingOverlay as HTMLElement).style.display = 'none';

        document.body.style.cssText = 'background-color: #222; color: #eee; margin: 0; padding: 0; overflow: auto; width: 100vw; height: 100vh;';
        
        app = new App();
        (window as any).app = app;
        
        await app.dawiyPluginController.waitForPluginsLoaded();
        await AppEventBridge.initPopout(app, popoutExtId);
        
        const container = document.createElement('div');
        container.className = 'dawiy-popout-container';
        container.style.cssText = 'padding: 10px; box-sizing: border-box; min-height: 100vh;';
        document.body.appendChild(container);
        
        app.dawiyPluginController.renderPluginInPopoutWindow(popoutExtId, container);
        hideLoading();
        return;
    }

    // Normal DAW Instantiation
    app = new App();

    // 4. Initialize Host
    await app.initHost();

    // デバッグ用: appをグローバルに公開
    (window as any).app = app;

    hideLoading();
    let interval: any

    interval = setInterval(() => {
        audioCtx.resume().then((_onfulfilled) => {
            clearInterval(interval);
        });
    }, 100);


    // --- Heartbeat Client ---
    const HEARTBEAT_INTERVAL_MS = 2000;
    const sendHeartbeat = () => {
        fetch(`${BACKEND_URL}/heartbeat`)
            .then(res => {
                if (!res.ok) throw new Error("Heartbeat error");
            })
            .catch(() => {
                // Server is down
                console.warn("Server connection lost. Attempting to close...");

                // Try to close window (may be blocked by browser)
                window.close();

                // Show disconnected screen
                document.body.innerHTML = `
                    <div style="
                        display: flex; 
                        justify-content: center; 
                        align-items: center; 
                        height: 100vh; 
                        background: #222; 
                        color: #ccc; 
                        font-family: sans-serif;
                        flex-direction: column;
                        text-align: center;
                    ">
                        <h1>Disconnected</h1>
                        <p>The server process has ended.</p>
                        <p>You can safely close this tab.</p>
                    </div>
                `;
            });
    };

    // Send immediately to prevent gap during reload
    sendHeartbeat();
    setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS);
    // ------------------------

})();



export { app, audioCtx };

