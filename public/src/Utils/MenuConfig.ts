import { t } from "./i18n";

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
    { id: "dawiy_plugin", visible: true, order: 6, i18nKey: "menu.dawiy_plugin", domId: "menu-container-dawiy-plugin" },
    { id: "about", visible: true, order: 7, i18nKey: "menu.about", domId: "menu-container-about" },
];

export class MenuConfig {
    static load(): MenuItemConfig[] {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored) {
            try {
                const parsed = JSON.parse(stored) as MenuItemConfig[];
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
        localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
    }

    static reset() {
        localStorage.removeItem(STORAGE_KEY);
        return [...DEFAULT_MENU_CONFIG];
    }

    private static mergeWithDefault(stored: MenuItemConfig[]): MenuItemConfig[] {
        // Ensure all default items exist in stored config
        const merged = [...stored];

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
