import App from "../App";
import { DEFAULT_SHORTCUTS, KeyCombo, ShortcutDefinition } from "../Data/Shortcuts";
import { t } from "../Utils/i18n";
import SettingsPersistenceController from "./SettingsPersistenceController";

const STORAGE_KEY = "dawiy_shortcuts";

export default class ShortcutController {
    private _app: App;
    private _shortcuts: Map<string, KeyCombo[]>; // actionId -> KeyCombos
    private _definitions: Map<string, ShortcutDefinition>; // actionId -> Definition (for metadata)
    private _recordingState: { actionId: string, index?: number } | null = null;

    constructor(app: App) {
        this._app = app;
        this._shortcuts = new Map();
        this._definitions = new Map();
        this.init();
    }

    private init() {
        // Initialize definitions with defaults
        DEFAULT_SHORTCUTS.forEach(def => {
            this._definitions.set(def.id, def);
            // Deep copy default keys to avoid mutation issues
            this._shortcuts.set(def.id, JSON.parse(JSON.stringify(def.defaultKeys)));
        });

        this.loadSettings();
        this.bindUIEvents();
    }

    private loadSettings() {
        try {
            // SettingsPersistenceController is already initialized in index.ts
            const stored = SettingsPersistenceController.get<any>(STORAGE_KEY);
            if (stored) {
                // stored is likely { actionId: KeyCombo[] }
                // If stored is string (legacy), parse it. But SettingsPersistenceController returns object/json.
                // Our backend returns object.
                // But wait, our API structure is flat keys. 
                // SettingsPersistenceController.get("dawiy_shortcuts") returns the value associated with that key.
                // Since we store JSON string in localStorage, did we decide to store Object in backend?
                // The backend handles JSON body. 
                // SettingsPersistenceController.save("key", value) sends { "key": value }.
                // So value can be object.

                let parsed = stored;
                if (typeof stored === "string") {
                    try { parsed = JSON.parse(stored); } catch (e) { }
                }

                for (const [id, keys] of Object.entries(parsed)) {
                    if (this._shortcuts.has(id)) {
                        this._shortcuts.set(id, keys as KeyCombo[]);
                    } else {
                        this._shortcuts.set(id, keys as KeyCombo[]);
                    }
                }
            }
        } catch (e) {
            console.error("Failed to load shortcuts", e);
        }
    }

    public saveSettings() {
        const minimalExport: Record<string, KeyCombo[]> = {};
        this._shortcuts.forEach((keys, id) => {
            // Only save if different from default? 
            // Or save all to be safe and consistent. Saving all is easier.
            minimalExport[id] = keys;
        });
        SettingsPersistenceController.save(STORAGE_KEY, minimalExport);
    }

    public resetToDefault() {
        this._shortcuts.clear();
        this._definitions.forEach((def, id) => {
            this._shortcuts.set(id, JSON.parse(JSON.stringify(def.defaultKeys)));
        });
        this.saveSettings();
    }

    /**
     * Checks if a keyboard event triggers a specific action.
     */
    public isTriggered(actionId: string, e: KeyboardEvent): boolean {
        const combos = this._shortcuts.get(actionId);
        if (!combos) return false;

        // Check if allow shortcuts even if input focused
        // Some users might want custom behavior, but generally we block keys on inputs.
        let activeElement = document.activeElement as HTMLElement;

        // Traverse shadow DOMs to find the real active element
        while (activeElement && activeElement.shadowRoot && activeElement.shadowRoot.activeElement) {
            activeElement = activeElement.shadowRoot.activeElement as HTMLElement;
        }

        const isInputFocused = activeElement && (
            activeElement.tagName === "INPUT" ||
            activeElement.tagName === "TEXTAREA" ||
            activeElement.isContentEditable
        );

        return combos.some(combo => {
            if (isInputFocused) {
                // If focusing an input, only allow shortcuts that have Control, Alt or Meta.
                // Simple keys (e.g. "1", "Space") or Shift+Key are blocked to allow typing.
                const hasCommandMod = combo.modifiers?.some(m =>
                    m === "Control" || m === "Alt" || m === "Meta"
                );
                if (!hasCommandMod) return false;
            }
            return this.matches(combo, e);
        });
    }

    private matches(combo: KeyCombo, e: KeyboardEvent): boolean {
        // Check key
        if (combo.key.toLowerCase() !== e.key.toLowerCase()) return false;

        // Check modifiers
        // Expected modifiers
        const expectedCtrl = combo.modifiers?.includes("Control") || false;
        const expectedShift = combo.modifiers?.includes("Shift") || false;
        const expectedAlt = combo.modifiers?.includes("Alt") || false;
        const expectedMeta = combo.modifiers?.includes("Meta") || false;

        // Actual modifiers
        // specific case for Mac 'Cmd' usually mapping to Meta, but sometimes Ctrl is used as command.
        // The definitions use "Control" or "Meta".
        // If the user is on Mac, typical "Ctrl+S" is "Cmd+S" (Meta).
        // The Default Shortcuts have both Ctrl and Meta variants for this reason.
        // So we strictly check match.

        return e.ctrlKey === expectedCtrl &&
            e.shiftKey === expectedShift &&
            e.altKey === expectedAlt &&
            e.metaKey === expectedMeta;
    }

    /**
     * Returns the definition for a given action ID.
     */
    public getDefinition(actionId: string): ShortcutDefinition | undefined {
        return this._definitions.get(actionId);
    }

    /**
     * Returns all definitions (for UI).
     */
    public getDefinitions(): ShortcutDefinition[] {
        return Array.from(this._definitions.values());
    }

    /**
     * Returns the current key combos for an action.
     */
    public getShortcuts(actionId: string): KeyCombo[] {
        return this._shortcuts.get(actionId) || [];
    }

    /**
     * Updates shortcuts for an action.
     * Throws error if conflict exists.
     */
    public updateShortcut(actionId: string, combos: KeyCombo[]) {
        // Conflict check
        for (const combo of combos) {
            const conflict = this.findConflict(combo, actionId);
            if (conflict) {
                // Determine if we should throw or just return info.
                // User requirement: "display 'already registered' and disable registration".
                throw new Error(`Conflict with action: ${this._definitions.get(conflict)?.description || conflict}`);
            }
        }

        this._shortcuts.set(actionId, combos);
        this.saveSettings();
    }

    /**
     * Finds if a key combo is already used by ANOTHER action.
     * Returns the conflicting actionId or null.
     */
    public findConflict(combo: KeyCombo, excludeActionId?: string): string | null {
        for (const [id, existingCombos] of this._shortcuts.entries()) {
            if (id === excludeActionId) continue;
            for (const existing of existingCombos) {
                if (this.areCombosEqual(combo, existing)) {
                    return id;
                }
            }
        }
        return null;
    }

    private areCombosEqual(a: KeyCombo, b: KeyCombo): boolean {
        if (a.key.toLowerCase() !== b.key.toLowerCase()) return false;

        const sortMods = (mods?: string[]) => (mods || []).slice().sort().join(",");
        return sortMods(a.modifiers) === sortMods(b.modifiers);
    }

    private getOS(): "mac" | "other" {
        // Simple detection
        if (typeof navigator !== "undefined" &&
            (navigator.platform.toUpperCase().indexOf("MAC") >= 0 || navigator.userAgent.toUpperCase().indexOf("MAC") >= 0)) {
            return "mac";
        }
        return "other";
    }

    /**
     * Filters combos for display based on OS preferences.
     * E.g. if both Ctrl+S and Cmd+S exist, show only the OS-relevant one.
     */
    private filterCombosForOS(combos: KeyCombo[]): KeyCombo[] {
        const os = this.getOS();
        const result: KeyCombo[] = [];

        // Helper to check if two combos are identical ignoring the Control/Meta difference
        const isSameKey = (a: KeyCombo, b: KeyCombo) => a.key.toLowerCase() === b.key.toLowerCase();

        combos.forEach(combo => {
            // Check if this combo has a "counterpart" with switched modifiers
            const hasCtrl = combo.modifiers?.includes("Control");
            const hasMeta = combo.modifiers?.includes("Meta");

            if (hasCtrl && !hasMeta) {
                // Check if there is a Meta counterpart
                const metaCounterpart = combos.find(c =>
                    isSameKey(c, combo) && c.modifiers?.includes("Meta") && !c.modifiers?.includes("Control")
                );
                if (metaCounterpart && os === "mac") return; // Skip Ctrl version on Mac if Meta exists
            }
            if (hasMeta && !hasCtrl) {
                // Check if there is a Control counterpart
                const ctrlCounterpart = combos.find(c =>
                    isSameKey(c, combo) && c.modifiers?.includes("Control") && !c.modifiers?.includes("Meta")
                );
                if (ctrlCounterpart && os !== "mac") return; // Skip Meta version on non-Mac if Ctrl exists
            }

            result.push(combo);
        });

        return result;
    }

    /**
     * Registers a new shortcut definition (e.g. from a plugin).
     */
    public registerPluginShortcut(def: ShortcutDefinition) {
        if (this._definitions.has(def.id)) {
            console.warn(`Shortcut definition ${def.id} already exists. Overwriting.`);
        }
        this._definitions.set(def.id, def);

        // If not already in shortcuts (loaded from storage), set default
        if (!this._shortcuts.has(def.id)) {
            this._shortcuts.set(def.id, JSON.parse(JSON.stringify(def.defaultKeys)));
        }
    }

    public async refreshUI() {
        if (!this._app.keyboardShortcutsView) return;
        const container = this._app.keyboardShortcutsView.listContainer;
        if (!container) return;

        container.innerHTML = "";
        this._app.keyboardShortcutsView.errorDiv.textContent = "";
        this._recordingState = null;

        // Prevent default context menu on the whole list
        container.oncontextmenu = (e) => e.preventDefault();

        // Group by category
        const categories = new Map<string, ShortcutDefinition[]>();
        this._definitions.forEach(def => {
            if (!categories.has(def.category)) {
                categories.set(def.category, []);
            }
            categories.get(def.category)!.push(def);
        });

        // Render categories
        categories.forEach((defs, category) => {
            this.renderCategory(category, defs, container);
        });
    }

    private renderCategory(category: string, defs: ShortcutDefinition[], container: HTMLElement) {
        const catHeader = document.createElement("div");
        catHeader.textContent = t(`category.${category}`) || category.toUpperCase();
        catHeader.style.cssText = "font-weight: bold; margin-top: 10px; margin-bottom: 5px; color: #ddd; border-bottom: 1px solid #555;";
        container.appendChild(catHeader);

        defs.forEach(def => {
            const row = this.createShortcutRow(def);
            container.appendChild(row);
        });
    }

    private createShortcutRow(def: ShortcutDefinition): HTMLElement {
        const row = document.createElement("div");
        row.style.cssText = "display: flex; justify-content: space-between; align-items: center; padding: 5px 0; border-bottom: 1px solid #333;";

        const desc = document.createElement("span");
        desc.textContent = t(def.description);
        desc.style.flex = "1";
        desc.style.marginRight = "10px";
        row.appendChild(desc);

        const keysContainer = document.createElement("div");
        keysContainer.style.display = "flex";
        keysContainer.style.gap = "5px";
        keysContainer.style.flexWrap = "wrap";
        keysContainer.style.justifyContent = "flex-end";
        keysContainer.style.maxWidth = "50%";

        const combos = this._shortcuts.get(def.id) || [];
        const visibleCombos = this.filterCombosForOS(combos);

        visibleCombos.forEach((combo) => {
            // Find actual index in real array for deletion
            const realIndex = combos.indexOf(combo);

            const keyBtn = document.createElement("button");
            keyBtn.className = "settings-btn"; // reuse class
            keyBtn.textContent = this.formatKeyCombo(combo);
            keyBtn.title = "Click to rebind, Right-click to delete";
            keyBtn.style.fontSize = "12px";
            keyBtn.onclick = () => this.startRecording(def.id, realIndex);
            keyBtn.oncontextmenu = (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.deleteShortcut(def.id, realIndex);
            };
            keysContainer.appendChild(keyBtn);
        });

        // Add button
        const addBtn = document.createElement("button");
        addBtn.textContent = t("common.add");
        addBtn.className = "settings-btn";
        addBtn.style.padding = "2px 6px";
        addBtn.style.backgroundColor = "#28a745"; // Green
        addBtn.style.color = "white";
        addBtn.style.border = "none";
        addBtn.onclick = () => this.startRecording(def.id);
        keysContainer.appendChild(addBtn);

        row.appendChild(keysContainer);
        return row;
    }

    private formatKeyCombo(combo: KeyCombo): string {
        const parts: string[] = [];
        const isMac = this.getOS() === "mac";
        if (combo.modifiers) {
            combo.modifiers.forEach(m => {
                if (m === "Control") parts.push(isMac ? "Ctrl" : "Ctrl");
                else if (m === "Meta") parts.push(isMac ? "Cmd" : "Win");
                else parts.push(m);
            });
        }
        // Capitalize key
        let keyDisplay = combo.key;
        if (keyDisplay === " ") keyDisplay = "Space";
        else if (keyDisplay.length === 1) keyDisplay = keyDisplay.toUpperCase();

        parts.push(keyDisplay);
        return parts.join("+");
    }

    public startRecording(actionId: string, index?: number) {
        this._recordingState = { actionId, index };
        if (this._app.keyboardShortcutsView) {
            this._app.keyboardShortcutsView.errorDiv.textContent = "Press key combination...";
            this._app.keyboardShortcutsView.errorDiv.style.color = "#4dabf7"; // Blue
        }
    }

    private async deleteShortcut(actionId: string, index: number) {
        if (await confirm(t("messages.confirm_delete_shortcut"))) {
            const shortcuts = this._shortcuts.get(actionId);
            if (shortcuts) {
                shortcuts.splice(index, 1);
                this.saveSettings(); // save immediately
                this.refreshUI(); // refresh
            }
        }
    }

    private bindUIEvents() {
        if (this._app.keyboardShortcutsView && this._app.keyboardShortcutsView.resetBtn) {
            this._app.keyboardShortcutsView.resetBtn.onclick = async () => {
                if (await confirm(t("messages.confirm_reset_shortcuts"))) {
                    this.resetToDefault();
                    this.refreshUI();
                }
            };
        }

        // Global key listener for recording
        window.addEventListener("keydown", (e) => {
            if (this._recordingState && !e.repeat) {
                // Ignore modifier-only presses
                const key = e.key;
                if (key === "Control" || key === "Shift" || key === "Alt" || key === "Meta") return;

                e.preventDefault();
                e.stopPropagation();

                const modifiers: ("Control" | "Shift" | "Alt" | "Meta")[] = [];
                if (e.ctrlKey) modifiers.push("Control");
                if (e.shiftKey) modifiers.push("Shift");
                if (e.altKey) modifiers.push("Alt");
                if (e.metaKey) modifiers.push("Meta");

                const newCombo: KeyCombo = { key, modifiers: modifiers.length > 0 ? modifiers : undefined };

                this.finalizeRecording(newCombo);
            }
        }, true); // Capture phase to prevent other handlers
    }

    private finalizeRecording(combo: KeyCombo) {
        if (!this._recordingState) return;
        const { actionId, index } = this._recordingState;

        try {
            // Check conflict
            const conflict = this.findConflict(combo, actionId);
            if (conflict) {
                const conflictName = t(this._definitions.get(conflict)?.description || "") || conflict;
                throw new Error(`Conflict with: ${conflictName}`);
            }

            const shortcuts = this._shortcuts.get(actionId) || [];
            if (typeof index === "number") {
                shortcuts[index] = combo;
            } else {
                shortcuts.push(combo);
            }

            this.updateShortcut(actionId, shortcuts); // Saves
            this.refreshUI();
        } catch (e: any) {
            if (this._app.keyboardShortcutsView) {
                this._app.keyboardShortcutsView.errorDiv.textContent = e.message;
                this._app.keyboardShortcutsView.errorDiv.style.color = "#ff6b6b"; // Red
            }
            this._recordingState = null; // Exit recording on error? Or keep?
            // User might want to try again.
            // But if we clear recording state, they have to click again.
            // Let's clear for now to avoid stuck state.
        }
    }
}

