import { DAWIYPlugin } from "../IDawiyPlugin";
import DawiyPluginBase from "../DawiyPluginBase";
import App from "../../App";

@DAWIYPlugin
export default class SampleIOPlugin extends DawiyPluginBase {
    id = "sample-io-plugin";
    name = "Sample IO & UI Plugin";
    description = "Demonstrates Sidebar UI and File I/O hooks.";
    group = "DevTools";

    private sidebarContainer: HTMLElement | null = null;
    private textArea: HTMLTextAreaElement | null = null;

    constructor(app: App) {
        super(app);
    }

    public override onInit(host: any) {
        super.onInit(host);

        // 1. Register Sidebar Item
        // We create a container that will be attached when the sidebar is opened
        const sidebarContent = document.createElement("div");
        sidebarContent.style.width = "100%";
        sidebarContent.style.height = "100%";
        sidebarContent.style.display = "flex";
        sidebarContent.style.flexDirection = "column";
        sidebarContent.style.padding = "10px";
        sidebarContent.style.color = "white";

        sidebarContent.innerHTML = `
            <h3>Sample IO</h3>
            <p>Type text here and use Export/Import.</p>
            <textarea id="sample-io-text" style="flex-grow: 1; background: #333; color: white; border: 1px solid #555; margin-bottom: 10px;"></textarea>
            <div style="display: flex; gap: 5px;">
                <button id="btn-save-fs" class="btn btn-sm btn-secondary">Direct FS Save</button>
                <button id="btn-load-fs" class="btn btn-sm btn-secondary">Direct FS Read</button>
            </div>
        `;

        // Use 'host' argument which is non-null here
        host.ui.registerSidebarItem("sample-io", "bi-file-earmark-text", "Sample IO", sidebarContent);

        // Bind events for sidebar elements
        this.textArea = sidebarContent.querySelector("#sample-io-text");

        const btnSave = sidebarContent.querySelector("#btn-save-fs");
        if (btnSave) {
            btnSave.addEventListener("click", () => this.saveDirectly());
        }
        const btnLoad = sidebarContent.querySelector("#btn-load-fs");
        if (btnLoad) {
            btnLoad.addEventListener("click", () => this.loadDirectly());
        }


        // 2. Register Importer for .sampletext
        host.io.registerImporter(".sampletext", async (file: File) => {
            console.log("[SampleIOPlugin] Importer called for:", file.name); // Debug
            const text = await file.text();
            console.log("[SampleIOPlugin] File content length:", text.length); // Debug
            if (this.textArea) {
                this.textArea.value = text;
                host.ui.showToast(`Imported ${file.name}`);
            } else {
                host.ui.showToast("Sidebar not initialized/found?", true);
            }
        });

        // 3. Register Exporter for .sampletext
        host.io.registerExporter("Sample Text Export (.sampletext)", async () => {
            if (!this.textArea) {
                throw new Error("No text to export");
            }
            const content = this.textArea.value;
            // Use basic fs write (which falls back to download in web)
            await host.fs.writeFile("export.sampletext", content);
            host.ui.showToast("Exported to export.sampletext");
        });
    }

    private async saveDirectly() {
        if (!this.textArea || !this.host) return;
        try {
            // Save to a fixed path (Tauri) or download (Web)
            await this.host.fs.writeFile("direct_save.txt", this.textArea.value);
            this.host.ui.showToast("Saved direct_save.txt");
        } catch (e) {
            this.host?.ui.showToast(`Save failed: ${e}`, true);
        }
    }

    private async loadDirectly() {
        if (!this.textArea || !this.host) return;
        try {
            // In web, this should trigger a picker if path is empty
            const content = await this.host.fs.readFile("");
            this.textArea.value = content;
            this.host.ui.showToast("Loaded file");
        } catch (e) {
            this.host?.ui.showToast(`Load failed: ${e}`, true);
        }
    }

    public override render(container: HTMLElement) {
        container.innerHTML = "<h3>Sample IO Plugin</h3><p>This plugin adds a sidebar item and IO hooks. Check the sidebar!</p>";
    }
}
