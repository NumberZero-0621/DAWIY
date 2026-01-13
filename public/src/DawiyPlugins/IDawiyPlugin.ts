export interface IDawiyPlugin {
    id: string;
    name: string;
    description: string;
    /**
     * Called when the plugin is selected/opened in the UI.
     * Use this to render your plugin's interface into the provided container.
     * @param container The HTML element where the plugin should render its UI.
     */
    render(container: HTMLElement): void;
    
    /**
     * Optional: Called when the plugin is activated.
     */
    onActivate?(): void;
    
    /**
     * Optional: Called when the plugin is deactivated or closed.
     * Use this to clean up event listeners, timers, etc.
     */
    onDeactivate?(): void;
}
