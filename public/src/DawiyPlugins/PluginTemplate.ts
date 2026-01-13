import App from "../App";
import { IDawiyPlugin } from "./IDawiyPlugin";

/**
 * A template for creating new DAWIY plugins.
 * Copy this file and rename it to start your own plugin.
 */
export default class PluginTemplate implements IDawiyPlugin {
    // Unique ID for the plugin. Use lowercase and hyphens.
    id = "my-new-plugin";
    
    // Display name shown in the UI.
    name = "My New Plugin";
    
    // Brief description of what the plugin does.
    description = "A description of my awesome new plugin.";

    private app: App;
    private container: HTMLElement | null = null;

    constructor(app: App) {
        this.app = app;
    }

    /**
     * Renders the plugin's UI into the provided container.
     * @param container The HTML element where you should build your UI.
     */
    public render(container: HTMLElement) {
        this.container = container;
        
        // Clear container
        container.innerHTML = '';
        
        // Basic styling for the container
        this.applyContainerStyles(container);

        // Example: Add a Title
        const title = document.createElement("h3");
        title.textContent = this.name;
        title.style.margin = "0 0 10px 0";
        container.appendChild(title);

        // Example: Add a Button
        const button = document.createElement("button");
        button.textContent = "Click Me";
        button.style.padding = "8px 16px";
        button.style.background = "#0c85d0";
        button.style.color = "white";
        button.style.border = "none";
        button.style.borderRadius = "4px";
        button.style.cursor = "pointer";
        button.onclick = () => this.doSomething();
        container.appendChild(button);

        // Example: Add descriptive text
        const info = document.createElement("p");
        info.textContent = "Check the console after clicking the button.";
        info.style.marginTop = "10px";
        container.appendChild(info);
    }

    /**
     * Optional: Called when the plugin is activated/opened.
     */
    public onActivate() {
        console.log(`${this.name} activated`);
    }

    /**
     * Optional: Called when the plugin is deactivated/closed.
     */
    public onDeactivate() {
        console.log(`${this.name} deactivated`);
    }

    /**
     * Custom method to implement your plugin's logic.
     */
    private doSomething() {
        console.log("Button clicked!");
        
        // Example: Accessing DAWIY state
        const track = this.app.tracksController.selectedTrack;
        if (track) {
            console.log("Selected track:", track.name);
            alert(`Selected track: ${track.name}`);
        } else {
            console.log("No track selected.");
            alert("No track selected. Select a track in the editor first.");
        }
    }

    /**
     * Helper to apply basic styles to the container.
     */
    private applyContainerStyles(container: HTMLElement) {
        container.style.color = "#eee";
        container.style.padding = "10px";
        container.style.display = "flex";
        container.style.flexDirection = "column";
        container.style.gap = "10px";
        container.style.overflowY = "auto";
        container.style.height = "100%";
    }
}
