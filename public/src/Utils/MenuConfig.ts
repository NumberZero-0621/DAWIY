import { t } from "./i18n";
import SettingsPersistenceController from "../Controllers/SettingsPersistenceController";

export interface MenuItemConfig {
    id: string;
    visible: boolean;
    order: number;
    i18nKey: string;
    domId: string; // The ID of the container element in the menu bar
}

const STORAGE_KEY = "wam_studio_menu_config";

export const DEFAULT_MENU_CONFIG: MenuItemConfig[] = [
    { id: "load_project", visible: true, order: 0, i18nKey: "menu.load_project", domId: "menu-container-load-project" },
    { id: "save_project", visible: true, order: 1, i18nKey: "menu.save_project", domId: "menu-container-save-project" },
    { id: "export_project", visible: true, order: 2, i18nKey: "menu.export_project", domId: "menu-container-export-project" },
    { id: "import", visible: true, order: 3, i18nKey: "menu.import", domId: "menu-container-import" },
    { id: "select_demo", visible: false, order: 4, i18nKey: "menu.select_demo", domId: "menu-container-select-demo" },
    { id: "settings", visible: true, order: 5, i18nKey: "menu.settings", domId: "menu-container-settings" }, // Can't be hidden, logic handled in view
    { id: "plugins", visible: true, order: 6, i18nKey: "menu.plugins", domId: "menu-container-plugins" },
    { id: "about", visible: true, order: 7, i18nKey: "menu.about", domId: "menu-container-about" },
];

export class MenuConfig {
    static load(): MenuItemConfig[] {
        // As initialized in index.ts, SettingsPersistenceController is ready.
        const stored = SettingsPersistenceController.get<MenuItemConfig[]>(STORAGE_KEY);
        if (stored) {
            try {
                // If it is string for some legacy reason (shouldn't be with new backend)
                const parsed = (typeof stored === 'string') ? JSON.parse(stored) : stored;
                // Merge with default to handle potential schema changes or missing keys
                return this.mergeWithDefault(parsed);
            } catch (e) {
                console.warn("Failed to parse menu config, using default.", e);
                return [...DEFAULT_MENU_CONFIG];
            }
        }
        return [...DEFAULT_MENU_CONFIG];
    }

    static save(config: MenuItemConfig[]) {
        SettingsPersistenceController.save(STORAGE_KEY, config);
    }

    static reset() {
        // localStorage.removeItem(STORAGE_KEY);
        // We can't easily remove key from JSON yet via our API (we only merge matching keys).
        // But we can overwrite it with default.
        const defaults = [...DEFAULT_MENU_CONFIG];
        // Or specific "reset" logic if needed. 
        // For now, saving as null? No, API implementation of POST /settings merges.
        // It doesn't delete.
        // Let's just save the defaults.
        this.save(defaults);
        return defaults;
    }

    private static mergeWithDefault(stored: MenuItemConfig[]): MenuItemConfig[] {
        // Filter out stored items that are no longer in DEFAULT_MENU_CONFIG
        const validStored = stored.filter(s => DEFAULT_MENU_CONFIG.some(d => d.id === s.id));

        // Use validStored as base
        const merged = [...validStored];

        DEFAULT_MENU_CONFIG.forEach(defaultItem => {
            if (!merged.find(item => item.id === defaultItem.id)) {
                merged.push(defaultItem);
            }
        });

        // Ensure "Settings" is always visible (safety check)
        const settings = merged.find(item => item.id === "settings");
        if (settings) {
            settings.visible = true;
        }

        return merged.sort((a, b) => a.order - b.order);
    }
}
