import AboutTemplate from "./Templates/AboutTemplate.html";
import DawiyPluginTemplate from "./Templates/DawiyPluginTemplate.html";
import KeyboardShortcutsTemplate from "./Templates/KeyboardShortcutsTemplate.html";
import LatencyTemplate from "./Templates/LatencyTemplate.html";
import PluginWindowTemplate from "./Templates/PluginWindowTemplate.html";
import ProjectTemplate from "./Templates/ProjectTemplate.html";
import SettingsTemplate from "./Templates/SettingsTemplate.html";
import LoadingOverlayTemplate from "./Templates/LoadingOverlayTemplate.html";
import MenuBarTemplate from "./Templates/MenuBarTemplate.html";
import AppTemplate from "./Templates/AppTemplate.html";
import MenuCustomizationTemplate from "./Templates/MenuCustomizationTemplate.html";
import WamPluginTemplate from "./Templates/WamPluginTemplate.html";

export default class TemplateLoader {

    public static load() {
        this.inject("loading-overlay", LoadingOverlayTemplate);
        this.inject("menu-bar", MenuBarTemplate);
        this.inject("app", AppTemplate);

        this.inject("about-window", AboutTemplate);
        this.inject("settings-window", SettingsTemplate);
        this.inject("latency-window", LatencyTemplate);
        this.inject("keyboard-shortcuts-window", KeyboardShortcutsTemplate);
        this.inject("project-window", ProjectTemplate);
        this.inject("plugin-window", PluginWindowTemplate);
        this.inject("plugin-window", PluginWindowTemplate);
        this.inject("dawiy-plugin-window", DawiyPluginTemplate);
        this.inject("wam-plugin-window", WamPluginTemplate);
        this.inject("menu-customization-window", MenuCustomizationTemplate);
    }

    private static inject(id: string, html: string) {
        const el = document.getElementById(id);
        if (el) {
            el.innerHTML = html;
        } else {
            console.warn(`TemplateLoader: Element with id '${id}' not found.`);
        }
    }
}
