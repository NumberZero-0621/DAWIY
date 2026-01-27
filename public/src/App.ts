// @ts-ignore
import UndoManager from "undo-manager/lib/undomanager.js";


import JSZip from "jszip";
import TracksController from "./Controllers/Editor/Track/TracksController";
import HostController from "./Controllers/HostController";
import HostView from "./Views/HostView";

import { audioCtx } from ".";
import { RingBuffer } from "./Audio/Utils/Buffer/RingBuffer";
import AutomationController from "./Controllers/AutomationController";
import EditorController from "./Controllers/Editor/EditorController";
import LoopController from "./Controllers/Editor/LoopController";
import PlayheadController from "./Controllers/Editor/PlayheadController";
import RegionController from "./Controllers/Editor/Region/RegionController";
import WaveformController from "./Controllers/Editor/WaveformController";
import ExporterController from "./Controllers/ExportController";
import KeyboardController from "./Controllers/KeyboardController";
import LatencyController from "./Controllers/LatencyController";
import PluginsController from "./Controllers/PluginsController";
import ProjectController from "./Controllers/ProjectController";
import RecorderController from "./Controllers/Recording/RecorderController";
import SettingsController from "./Controllers/SettingsController";
import DawiyPluginController from "./Controllers/DawiyPluginController";
import Loader from "./Loader/Loader";
import Host from "./Models/Track/Host";
import AboutView from "./Views/AboutView";
import AutomationView from "./Views/AutomationView";
import EditorView from "./Views/Editor/EditorView";
import KeyboardShortcutsView from "./Views/KeyboardShortcutsView";
import LatencyView from "./Views/LatencyView";
import PluginsView from "./Views/PluginsView";
import ProjectView from "./Views/ProjectView";
import SettingsView from "./Views/SettingsView";
import DawiyPluginView from "./Views/DawiyPluginView";
import TracksView from "./Views/TracksView";
import PianoRollController from "./Controllers/Editor/PianoRoll/PianoRollController";
import AutoSaveController from "./Controllers/AutoSaveController";
import ContextMenuController from "./Controllers/ContextMenuController";

/**
 * Main class for the host. Start all controllers, views and models. All controllers and views are accessible frome this app.
 */
export default class App {

    hostController: HostController;
    tracksController: TracksController;
    pluginsController: PluginsController;
    automationController: AutomationController;
    recorderController: RecorderController;
    latencyController: LatencyController;
    settingsController: SettingsController;
    dawiyPluginController: DawiyPluginController;
    projectController: ProjectController;
    editorController: EditorController;
    waveformController: WaveformController;
    regionsController: RegionController;
    playheadController: PlayheadController
    keyboardController: KeyboardController;
    exportController: ExporterController;
    loopController: LoopController;
    pianoRollController: PianoRollController;
    autoSaveController: AutoSaveController;
    contextMenuController: ContextMenuController;

    hostView: HostView;
    tracksView: TracksView;
    pluginsView: PluginsView;
    automationView: AutomationView;
    latencyView: LatencyView;
    settingsView: SettingsView;
    dawiyPluginView: DawiyPluginView;
    projectView: ProjectView;
    editorView: EditorView;
    aboutView: AboutView;

    keyboardShortcutsView: KeyboardShortcutsView;

    host: Host;
    loader: Loader;

    undoManager: UndoManager;
    audioLoopBrowser: any;

    public static TOOL_MODE: "SELECT" | "PEN" = "SELECT";

    constructor() {
        this.loader = new Loader(this);

        this.hostView = new HostView();
        this.tracksView = new TracksView();
        this.pluginsView = new PluginsView();
        this.automationView = new AutomationView();
        this.latencyView = new LatencyView();
        this.settingsView = new SettingsView();
        this.dawiyPluginView = new DawiyPluginView();
        this.projectView = new ProjectView();
        this.editorView = new EditorView();
        this.aboutView = new AboutView();

        this.keyboardShortcutsView = new KeyboardShortcutsView();

        this.editorController = new EditorController(this);
        this.waveformController = new WaveformController(this);
        this.regionsController = new RegionController(this);
        this.tracksController = new TracksController(this);
        this.host = new Host(this, audioCtx, this.tracksController.tracks);
        this.playheadController = new PlayheadController(this);
        this.hostController = new HostController(this);
        this.pluginsController = new PluginsController(this);
        this.automationController = new AutomationController(this);
        this.recorderController = new RecorderController(this);
        this.latencyController = new LatencyController(this);
        this.settingsController = new SettingsController(this);
        this.dawiyPluginController = new DawiyPluginController(this);
        this.dawiyPluginController.setView(this.dawiyPluginView);
        this.projectController = new ProjectController(this);
        this.keyboardController = new KeyboardController(this);
        this.exportController = new ExporterController(this);
        this.loopController = new LoopController(this);
        this.pianoRollController = new PianoRollController(this);
        this.autoSaveController = new AutoSaveController(this);
        this.contextMenuController = new ContextMenuController(this);

        this.hostController.addDraggableWindow(this.pluginsView, this.latencyView, this.settingsView,
            this.projectView, this.aboutView, this.keyboardShortcutsView, this.dawiyPluginView);

        this.undoManager = new UndoManager();
        const old = this.undoManager.add.bind(this.undoManager)

        //@ts-ignore
        /*this.undoManager.add=(...args)=>{
            old(...args)
            console.trace()
        }*/

        const buffer = new ArrayBuffer(256)
        const array = new Float32Array(4)
        const pipe = RingBuffer.make(buffer, Float32Array)
        //@ts-ignore
        window.pipe = pipe

        this.setupPluginDragAndDrop();
    }

    /**
     * Sets up global drag and drop for DAWIY Plugins (.ts files).
     */
    private setupPluginDragAndDrop() {
        window.addEventListener("dragover", (e) => {
            e.preventDefault();
            e.stopPropagation();
            // Show copy cursor
            if (e.dataTransfer) {
                e.dataTransfer.dropEffect = "copy";
            }
        });

        window.addEventListener("drop", async (e) => {
            e.preventDefault();
            e.stopPropagation();

            if (!e.dataTransfer || !e.dataTransfer.items) return;

            const items = Array.from(e.dataTransfer.items);

            for (const item of items) {
                const entry = item.webkitGetAsEntry();
                if (entry) {
                    await this.traverseFileTree(entry);
                }
            }
        });
    }

    private async traverseFileTree(entry: any, path: string = "") {
        if (entry.isFile) {
            if (entry.name.endsWith('.ts')) {
                this.uploadEntryFile(entry, path);
            } else if (entry.name.endsWith('.zip')) {
                this.processZipEntry(entry, path);
            }
        } else if (entry.isDirectory) {
            const dirReader = entry.createReader();
            dirReader.readEntries(async (entries: any[]) => {
                for (const childEntry of entries) {
                    await this.traverseFileTree(childEntry, path + entry.name + "/");
                }
            });
        }
    }

    private uploadEntryFile(fileEntry: any, path: string) {
        fileEntry.file((file: File) => {
            const reader = new FileReader();
            reader.onload = (event) => {
                const content = event.target?.result as string;
                if (!content) return;
                this.uploadPlugin(path + file.name, content, file.name);
            };
            reader.readAsText(file);
        });
    }

    private processZipEntry(fileEntry: any, path: string) {
        fileEntry.file(async (file: File) => {
            try {
                const zip = await JSZip.loadAsync(file);
                zip.forEach(async (relativePath, zipEntry) => {
                    if (zipEntry.dir) return; // Ignore directories
                    if (!zipEntry.name.endsWith('.ts')) return; // Allow only .ts inside zip for now

                    const content = await zipEntry.async("string");
                    // Combine the path where zip was dropped + zip internal structure
                    // If we want to extract ZIP content AS IS into the target path:
                    // usually zip contains a folder structure.
                    const fullPath = path + relativePath;
                    this.uploadPlugin(fullPath, content, zipEntry.name);
                });
            } catch (err) {
                this.showToast(`Error reading ZIP file: ${err}`, true);
            }
        });
    }

    /**
     * Uploads the plugin content to the server.
     * @param fullPath The full path (including filename) relative to DawiyPlugins root.
     * @param content The file content string.
     * @param displayName Name to display in toasts (usually just filename).
     */
    public uploadPlugin(fullPath: string, content: string, displayName: string): Promise<void> {
        // Simple check for IDawiyPlugin import or implementation
        // Matches: import ... IDawiyPlugin ... or implements IDawiyPlugin
        // Allow "export default class ..." too for simpler plugins
        if (fullPath.endsWith('.json') || content.includes('IDawiyPlugin') || content.includes('implements IDawiyPlugin') || content.includes('export default class')) {
            return fetch('/upload-plugin', {
                method: 'POST',
                headers: {
                    'Content-Type': 'text/plain',
                    // Encode the path to handle special characters if needed, but usually raw path is fine for headers if simple ascii
                    'x-filename': fullPath
                },
                body: content
            })
                .then(response => {
                    if (response.ok) {
                        this.showToast(`Plugin "${displayName}" installed! App will reload shortly.`);
                    } else if (response.status === 409) {
                        this.showToast(`同名のプラグイン/フォルダが既にインストールされています: "${fullPath}"`, true);
                    } else {
                        this.showToast(`Failed to install plugin: ${response.statusText}`, true);
                    }
                })
                .catch(err => {
                    this.showToast(`Error uploading plugin: ${err}`, true);
                });
        }
        return Promise.resolve();
    }

    public showToast(message: string, isError: boolean = false) {
        let toast = document.getElementById("dawiy-toast");
        if (!toast) {
            toast = document.createElement("div");
            toast.id = "dawiy-toast";
            toast.style.position = "fixed";
            toast.style.bottom = "20px";
            toast.style.right = "20px";
            toast.style.padding = "15px 25px";
            toast.style.borderRadius = "5px";
            toast.style.color = "white";
            toast.style.fontWeight = "bold";
            toast.style.zIndex = "9999";
            toast.style.transition = "opacity 0.5s ease-in-out";
            document.body.appendChild(toast);
        }

        toast.textContent = message;
        toast.style.backgroundColor = isError ? "#d9534f" : "#5cb85c"; // Red or Green
        toast.style.opacity = "1";
        toast.style.display = "block";

        setTimeout(() => {
            if (toast) {
                toast.style.opacity = "0";
                setTimeout(() => {
                    if (toast) toast.style.display = "none";
                }, 500);
            }
        }, 3000);
    }

    /**
     * Initialize the master track for the host.
     */
    async initHost() {
        await this.host.init()
        this.hostController.bindNodeListeners();

        // Auto-save Restore
        await this.autoSaveController.init();
        const restored = await this.autoSaveController.restore();
        if (restored) {
            console.log("Session restored from auto-save.");
        }
        this.autoSaveController.start();
    }

    /**
   * Do something once, and if undoable is true, save the do and undo functions in the undo manager.
   * todo is called, and if undoable id true, todo and undo are added to the undoManager respectively as redo and undo
   * @param undoable Is the action saved in the undo manager
   * @param todo The todo and redo function, called once and then saved as a redo function if undoable is true
   * @param undo The undo function, it should cancel what do did, it is save in the undo manager if undoable is true
   */
    doIt(undoable: boolean, todo: () => void, undo: () => void) {
        todo()
        if (undoable) this.addRedoUndo(todo, undo)
    }

    /**
     * Add redo and undo functions to the undo manager
     * @param redo The redo function
     * @param undo The undo function
     */
    addRedoUndo(redo: () => void, undo: () => void) {
        // to disable/enable undo/redo buttons if undo/redo is available
        const refreshButtons = () => {
            this.hostView.setUndoButtonState(this.undoManager.hasUndo())
            this.hostView.setRedoButtonState(this.undoManager.hasRedo())
        }

        const genericRedraw = () => {
            this.tracksController.tracks.forEach(track => {
                this.editorView.drawRegions(track);
            });
            if (this.pianoRollController.isVisible) {
                this.pianoRollController.redraw();
            }
        };

        this.undoManager.add({
            undo: () => {
                undo()
                genericRedraw()
                refreshButtons()
            },
            redo: () => {
                redo()
                genericRedraw()
                refreshButtons()
            }
        })
        refreshButtons()
    }
}

/**
 * In debug mode, the program should crash and print error for every unintended behaviors.
 * In production mode, the program should try to recover from errors and continue running.
 * Per example, removing a track that is not in the editor should crash the program in debug mode, but should be ignored in production mode.
 */
export const DEBUG_MODE = true;

export function crashOnDebug(...msgs: any[]) {
    console.error(...msgs)
    if (DEBUG_MODE) throw new Error(msgs.map(m => m.toString()).join())
}