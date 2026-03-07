import App from "../../App";
import { audioCtx } from "../../index";
import { MIDI, MIDINote } from "../../Audio/MIDI/MIDI";
import MIDIRegion from "../../Models/Region/MIDIRegion";

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
             * Add notes to a specific track. Automatically creates a region covering the notes.
             * @param trackId Index of the track in the tracksController.
             * @param notes Array of notes with pitch, start(ms), duration(ms), and optional velocity(0-127).
             */
            addNotes: (trackId: number, notes: { pitch: number, start: number, duration: number, velocity?: number }[]) => {
                const track = this.app.tracksController.getTrackById(trackId);
                if (!track) {
                    this.app.showToast(`Track with ID ${trackId} not found.`, true);
                    return;
                }

                if (notes.length === 0) return;

                // Calculate range and create MIDI
                let minStart = Infinity;
                let maxEnd = 0;
                notes.forEach(n => {
                    if (n.start < minStart) minStart = n.start;
                    if (n.start + n.duration > maxEnd) maxEnd = n.start + n.duration;
                });

                const regionDuration = maxEnd - minStart;
                const midi = new MIDI(500, regionDuration);

                notes.forEach(n => {
                    const localStart = (n.start ?? 0) - minStart;
                    midi.putNote(new MIDINote(n.pitch, n.velocity ?? 100, 0, n.duration), localStart);
                });

                const newRegion = new MIDIRegion(midi, minStart);

                const redo = () => {
                    this.app.regionsController.addRegion(track, newRegion);
                    if (this.app.pianoRollController.isVisible) {
                        this.app.pianoRollController.redraw();
                    }
                };
                const undo = () => {
                    this.app.regionsController.removeRegion(newRegion);
                    if (this.app.pianoRollController.isVisible) {
                        this.app.pianoRollController.redraw();
                    }
                };

                this.app.doIt(true, redo, undo);
                this.app.showToast(`Added ${notes.length} notes to ${track.element.name}.`);
            },

            /**
             * Get all regions on a specific track.
             */
            getRegions: (trackId: number): MIDIRegion[] => {
                const track = this.app.tracksController.getTrackById(trackId);
                if (!track) return [];
                return track.regions.filter((r): r is MIDIRegion => r instanceof MIDIRegion);
            },

            /**
             * Get the currently selected region in the editor.
             */
            getSelectedRegion: (): MIDIRegion | null => {
                const selected = this.app.regionsController.selection.primary;
                return selected instanceof MIDIRegion ? selected : null;
            },

            /**
             * Add notes to an existing MIDIRegion. Automatically expands the region if notes exceed its duration.
             */
            addNotesToRegion: (region: MIDIRegion, notes: { pitch: number, start: number, duration: number, velocity?: number }[]) => {
                if (!(region instanceof MIDIRegion)) {
                    this.app.showToast("Target region must be a MIDIRegion.", true);
                    return;
                }

                if (notes.length === 0) return;

                const track = this.app.tracksController.getTrackById(region.trackId);
                if (!track) return;

                const oldMidi = region.midi;
                const newMidi = oldMidi.clone();

                notes.forEach(n => {
                    // Convert absolute start time to local time relative to region start
                    const localStart = n.start - region.start;
                    newMidi.putNote(new MIDINote(n.pitch, n.velocity ?? 100, 0, n.duration), localStart);
                });

                // Expand duration if necessary
                let maxLocalEnd = newMidi.duration;
                notes.forEach(n => {
                    const localEnd = n.start - region.start + n.duration;
                    if (localEnd > maxLocalEnd) maxLocalEnd = localEnd;
                });
                if (maxLocalEnd > newMidi.duration) {
                    newMidi.duration = maxLocalEnd;
                }

                const redo = () => {
                    region.midi = newMidi;
                    this.app.regionsController.updateRegionView(region);
                };
                const undo = () => {
                    region.midi = oldMidi;
                    this.app.regionsController.updateRegionView(region);
                };

                this.app.doIt(true, redo, undo);
                this.app.showToast(`Added ${notes.length} notes to region.`);
            },

            /**
             * Get currently selected notes in the Piano Roll.
             */
            getSelectedNotes: (): { note: MIDINote, region: MIDIRegion, globalStart: number }[] => {
                const controller = this.app.pianoRollController;
                const selected = controller.selectedNotes;
                const result: { note: MIDINote, region: MIDIRegion, globalStart: number }[] = [];

                if (!controller.isVisible) return [];

                // We need to find which region each note belongs to.
                // This is a bit expensive but necessary as MIDINote doesn't store its owner.
                this.app.tracksController.tracks.forEach(track => {
                    track.regions.forEach(region => {
                        if (region instanceof MIDIRegion) {
                            region.midi.forEachNote((note, start) => {
                                if (selected.has(note)) {
                                    result.push({
                                        note,
                                        region,
                                        globalStart: region.start + start
                                    });
                                }
                            });
                        }
                    });
                });

                return result;
            },

            /**
             * Update properties of existing notes.
             */
            updateNotes: (updates: { region: MIDIRegion, note: MIDINote, pitch?: number, start?: number, duration?: number, velocity?: number }[]) => {
                if (updates.length === 0) return;

                const redo = () => {
                    updates.forEach(u => {
                        const midi = u.region.midi;
                        // Find local start of the original note
                        let originalLocalStart = -1;
                        midi.forEachNote((n, s) => { if (n === u.note) originalLocalStart = s; });

                        if (originalLocalStart !== -1) {
                            midi.removeNote(u.note, originalLocalStart);
                            const newNote = new MIDINote(
                                u.pitch ?? u.note.note,
                                u.velocity ?? u.note.velocity,
                                u.note.channel,
                                u.duration ?? u.note.duration
                            );
                            const newGlobalStart = u.start ?? (u.region.start + originalLocalStart);
                            const newLocalStart = newGlobalStart - u.region.start;
                            midi.putNote(newNote, newLocalStart);
                            // Update the reference in updates so undo knows what to remove
                            (u as any)._generatedNote = newNote;
                        }
                    });
                    if (this.app.pianoRollController.isVisible) this.app.pianoRollController.redraw();
                };

                const undo = () => {
                    updates.forEach(u => {
                        const midi = u.region.midi;
                        const generatedNote = (u as any)._generatedNote;
                        if (generatedNote) {
                            let genLocalStart = -1;
                            midi.forEachNote((n, s) => { if (n === generatedNote) genLocalStart = s; });
                            if (genLocalStart !== -1) {
                                midi.removeNote(generatedNote, genLocalStart);
                                // Find original local start
                                let originalLocalStart = -1;
                                // This is tricky because the original note is gone. 
                                // We should have stored it.
                                // Let's assume the position didn't change for finding purpose? No.
                                // Improvement: Store original local start in closure.
                            }
                        }
                    });
                };
                // Redo/Undo logic needs to be more robust for note objects.
                // Simplified version for now using re-draw:
                this.app.showToast(`Updating ${updates.length} notes...`);

                // Re-implementing more robustly:
                const changeEntries = updates.map(u => {
                    let locStart = -1;
                    u.region.midi.forEachNote((n, s) => { if (n === u.note) locStart = s; });
                    return { ...u, originalLocalStart: locStart };
                }).filter(e => e.originalLocalStart !== -1);

                const finalRedo = () => {
                    changeEntries.forEach(e => {
                        e.region.midi.removeNote(e.note, e.originalLocalStart);
                        const newNote = new MIDINote(
                            e.pitch ?? e.note.note,
                            e.velocity ?? e.note.velocity,
                            e.note.channel,
                            e.duration ?? e.note.duration
                        );
                        const newGlobalStart = e.start ?? (e.region.start + e.originalLocalStart);
                        e.region.midi.putNote(newNote, newGlobalStart - e.region.start);
                        (e as any)._newNote = newNote;
                    });
                    this.app.pianoRollController.redraw();
                };

                const finalUndo = () => {
                    changeEntries.forEach(e => {
                        const newNote = (e as any)._newNote;
                        let newLocStart = -1;
                        e.region.midi.forEachNote((n, s) => { if (n === newNote) newLocStart = s; });
                        if (newLocStart !== -1) {
                            e.region.midi.removeNote(newNote, newLocStart);
                            e.region.midi.putNote(e.note, e.originalLocalStart);
                        }
                    });
                    this.app.pianoRollController.redraw();
                };

                this.app.doIt(true, finalRedo, finalUndo);
            },

            /**
             * Get the current project name.
             */
            getProjectName: () => {
                // Assuming we can get it from ProjectView or similar
                // For now return a generic name if not available
                return "project";
            },

            /**
             * Get all tracks in the project.
             */
            getTracks: async () => {
                const tracksMap = this.app.tracksController.tracks;
                const result = [];
                for (let i = 0; i < tracksMap.length; i++) {
                    const track = tracksMap.get(i);
                    if (track) {
                        result.push({
                            id: track.id,
                            name: track.element.name,
                            color: track.color,
                            // Add more properties if needed
                        });
                    }
                }
                return result;
            },

            /**
             * Update a track's properties.
             * @param trackId The ID of the track to update.
             * @param updates Object containing properties to update (e.g., name).
             */
            updateTrack: async (trackId: number, updates: { name?: string, color?: string }) => {
                const track = this.app.tracksController.getTrackById(trackId);
                if (!track) {
                    this.app.showToast(`Track ${trackId} not found.`, true);
                    return;
                }

                const oldName = track.element.name;
                const oldColor = track.color;

                const redo = () => {
                    if (updates.name !== undefined) track.element.name = updates.name;
                    if (updates.color !== undefined) this.app.tracksController.setColor(track, updates.color);
                };

                const undo = () => {
                    if (updates.name !== undefined) track.element.name = oldName;
                    if (updates.color !== undefined) this.app.tracksController.setColor(track, oldColor);
                };

                this.app.doIt(true, redo, undo);
            },

            /**
             * Create a new track.
             * @param name Optional name for the new track.
             * @returns The newly created track object (simplified).
             */
            createTrack: async (name?: string) => {
                const track = await this.app.tracksController.createTrack();
                if (name) {
                    track.element.name = name;
                }
                return {
                    id: track.id,
                    name: track.element.name,
                    color: track.color
                };
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
