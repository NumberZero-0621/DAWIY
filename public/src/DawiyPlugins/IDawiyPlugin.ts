import HostAPI from "./API/HostAPI";

export interface IDawiyPlugin {
    id: string;
    name: string;
    description: string;
    group?: string;
    /**
     * Plugin categories.
     * Defines where this plugin should be displayed or used.
     */
    categories?: ('generator' | 'modifier' | 'analysis' | 'io' | 'ui')[];

    /**
     * Called when the plugin is loaded.
     * @param host The host API bridge.
     */
    onInit?(host: HostAPI): void;

    /**
     * Called when the plugin is selected/opened in the UI.
     * Use this to render your plugin's interface into the provided container.
     * @param container The HTML element where the plugin should render its UI.
     */
    render?(container: HTMLElement): void;

    /**
     * Optional: Called when the plugin is activated.
     */
    onActivate?(): void;

    /**
     * Optional: Called when the plugin is deactivated or closed.
     * Use this to clean up event listeners, timers, etc.
     */
    onDeactivate?(): void;

    /**
     * Optional: Get the data specific to the user (global settings).
     * This data persists across different projects but is deleted when the plugin is uninstalled.
     */
    getUserData?(): any;

    /**
     * Optional: Set the data specific to the user (global settings).
     */
    setUserData?(data: any): void;

    /**
     * Optional: Get the data specific to the current project.
     * This data is saved with the project file.
     */
    getProjectData?(): any;

    /**
     * Optional: Set the data specific to the current project.
     */
    setProjectData?(data: any): void;
}

export const pluginRegistry: any[] = [];

export function DAWIYPlugin(constructor: Function) {
    console.log(`[DAWIYPlugin] Registered: ${constructor.name}`);
    pluginRegistry.push(constructor);
}
