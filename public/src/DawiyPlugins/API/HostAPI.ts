import App from "../../App";
import { audioCtx } from "../../index";

/**
 * Bridge between Plugins and the Core System.
 * Should be passed to plugins during initialization.
 */
export default class HostAPI {
    private app: App;

    constructor(app: App) {
        this.app = app;
    }

    /**
     * File System Access (Tauri Bridge / Web Fallback)
     */
    public get fs() {
        return {
            /**
             * Read a text file.
             * @param path Absolute path (Tauri). In Web mode, if path is not provided, it triggers a file picker.
             */
            readFile: async (path: string = ""): Promise<string> => {
                // Check for Tauri
                if ((window as any).__TAURI__) {
                    try {
                        const { readTextFile } = (window as any).__TAURI__.fs;
                        return await readTextFile(path);
                    } catch (e) {
                        console.error("[HostAPI] Tauri invalid read", e);
                        throw e;
                    }
                }

                // Web Fallback: Trigger File Picker
                return new Promise((resolve, reject) => {
                    const input = document.createElement('input');
                    input.type = 'file';
                    input.onchange = (e) => {
                        const file = (e.target as HTMLInputElement).files?.[0];
                        if (file) {
                            const reader = new FileReader();
                            reader.onload = (evt) => resolve(evt.target?.result as string);
                            reader.onerror = (err) => reject(err);
                            reader.readAsText(file);
                        } else {
                            reject(new Error("No file selected"));
                        }
                    };
                    input.click();
                });
            },
            /**
             * Write content to a file.
             * @param path Absolute path (Tauri) or filename (Web download).
             * @param content String content.
             */
            writeFile: async (path: string, content: string): Promise<void> => {
                // Check for Tauri
                if ((window as any).__TAURI__) {
                    try {
                        const { writeTextFile } = (window as any).__TAURI__.fs;
                        return await writeTextFile(path, content);
                    } catch (e) {
                        console.error("[HostAPI] Tauri invalid write", e);
                        throw e;
                    }
                }

                // Web Fallback: Download
                const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = path || "download.txt";
                a.click();
                URL.revokeObjectURL(url);
            },
            /**
          * Show Open Dialog.
          * @returns Selected file path (Tauri) or null (Web - handled by readFile)
          */
            showOpenDialog: async (options: any = {}): Promise<string | null> => {
                if ((window as any).__TAURI__) {
                    try {
                        // Check for plugin-dialog or v1 dialog
                        const dialog = (window as any).__TAURI__.dialog || (window as any).__TAURI__.window.__TAURI_PLUGIN_DIALOG__;
                        if (dialog && dialog.open) {
                            const selected = await dialog.open(options);
                            return Array.isArray(selected) ? selected[0] : selected;
                        }
                    } catch (e) {
                        console.error("[HostAPI] Tauri dialog error", e);
                    }
                }
                // Web: We don't really have a "get path" dialog. 
                // We usually just use readFile() which handles the picker.
                return null;
            }
        };
    }

    /**
     * UI Manipulation
     */
    public get ui() {
        return {
            /**
             * Show a toast notification.
             */
            showToast: (message: string, isError: boolean = false) => {
                this.app.showToast(message, isError);
            },

            /**
             * Open a new floating window with the given content.
             * @param title Window title
             * @param content HTML content or Element
             */
            openWindow: (title: string, content: string | HTMLElement) => {
                // TODO: Implement proper window manager
                console.log(`[HostAPI] openWindow "${title}" called.`);
                alert(`${title}: ${content}`);
            },

            /**
             * Add an item to the sidebar.
             */
            registerSidebarItem: (id: string, icon: string, label: string, element: HTMLElement) => {
                this.app.hostView.addSidebarItem(id, icon, label, element);
            }
        };
    }

    /**
     * Project Access
     */
    public get project() {
        return {
            /**
             * Add notes to a specific track/region.
             * (Placeholder for future implementation)
             */
            addNotes: (trackId: number, notes: any[]) => {
                console.log(`[HostAPI] addNotes to track ${trackId}`, notes);
            },

            /**
             * Get the current project name.
             */
            getProjectName: () => {
                // Assuming we can get it from ProjectView or similar
                // For now return a generic name if not available
                return "project";
            }
        };
    }

    // Registries
    private importers: Map<string, (file: File) => Promise<void>> = new Map();

    /**
     * I/O Extensibility
     */
    public get io() {
        return {
            /**
             * Register a custom file importer.
             * @param extension File extension (e.g., ".mp3", ".flac")
             * @param callback Function to handle the file import
             */
            registerImporter: (extension: string, callback: (file: File) => Promise<void>) => {
                this.importers.set(extension.toLowerCase(), callback);
            },

            /**
             * Register a custom exporter.
             * Automatically adds a menu item to the Export menu.
             * @param name Name of the export format (e.g., "MP3 Export")
             * @param callback Function to handle export logic
             */
            registerExporter: (name: string, callback: () => Promise<void>) => {
                this.app.hostView.addExportMenuItem(name, async () => {
                    try {
                        await callback();
                    } catch (e) {
                        this.app.showToast(`Export failed: ${e}`, true);
                    }
                });
            },

            /**
             * Helper to get the rendered audio of the master track.
             * Useful for plugins that implement custom export formats (e.g., MP3, FLAC).
             */
            renderMasterAudio: async (): Promise<AudioBuffer> => {
                // We reuse the logic from ExporterController.
                // NOTE: This relies on internal App methods. 
                // We need to access processTrack logic or similar.

                // For simplicity, let's call a method we will add to ExportController 
                // OR duplicate the logic here if we want to keep API decoupled.
                // Ideally, expose `renderMasterTrack` in ExportController.

                // Let's assume we can access exportController.
                // But `processTrack` is private. We might need to make it public or add a public wrapper.
                // For now, let's try to simulate what exportSongs does but return the buffer instead of downloading.

                // Check if there's content to export.
                let maxDuration = this.app.regionsController.getMaxDurationRegions();
                if (maxDuration == 0) throw new Error(" Project is empty");

                const buffers: AudioBuffer[] = [];
                const { default: initializeWamHost } = await import("@webaudiomodules/sdk/src/initializeWamHost");

                // Render all tracks
                for (let i = 0; i < this.app.tracksController.tracks.length; i++) {
                    let track = this.app.tracksController.tracks.get(i);
                    // We need to call processTrack. Since it's private, we cast to any.
                    // THIS IS RISKY if internal API changes.
                    let buffer = await (this.app.exportController as any).processTrack(track, maxDuration, initializeWamHost);
                    if (buffer) buffers.push(buffer);
                }

                // Mix down
                // We need `exportMasterTrack` logic but returning the buffer.
                // The current `exportMasterTrack` renders to OfflineAudioContext again.

                // Let's implement a simplified mixdown here using OfflineAudioContext
                const offlineCtx = new OfflineAudioContext(2, audioCtx.sampleRate * maxDuration, audioCtx.sampleRate);

                // We use the Host Graph to render (which includes master plugins/volume)
                // Just like exportMasterTrack does.
                const [hostGroupId] = await initializeWamHost(offlineCtx);
                const graph = await this.app.host.host_graph.instantiate(offlineCtx, hostGroupId);
                graph.connect(offlineCtx.destination);

                // Wait a bit for plugins to init?
                await new Promise(r => setTimeout(r, 200));

                await graph.playEfficiently(0, maxDuration * 1000);
                const renderedBuffer = await offlineCtx.startRendering();

                await graph.dispose();
                return renderedBuffer;
            }
        };
    }

    /**
     * Internal: Get an importer for an extension
     */
    public getImporter(extension: string) {
        return this.importers.get(extension.toLowerCase());
    }
}
