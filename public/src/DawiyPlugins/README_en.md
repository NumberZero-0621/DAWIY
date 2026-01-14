# DAWIY Plugin Development Guide

This directory (`public/src/DawiyPlugins`) is the home for custom extensions and plugins for DAWIY.
Plugins allow you to extend the functionality of the DAW, add new UI tools, generators, or modify the state of the application.

## Getting Started

1.  **Create your plugin file:**
    Copy `PluginTemplate.ts` to a new file, e.g., `MyCoolPlugin.ts`.

2.  **Implement the interface:**
    Your class must implement the `IDawiyPlugin` interface.
    Below is a more comprehensive implementation example based on `PluginTemplate.ts`.
    ```typescript
    import App from "../App";
    import { IDawiyPlugin } from "./IDawiyPlugin";

    export default class MyCoolPlugin implements IDawiyPlugin {
        // Unique ID for the plugin (lowercase and hyphens recommended).
        id = "my-cool-plugin";
        
        // Display name shown in the UI.
        name = "My Cool Plugin";
        
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
            
            // Apply basic styling
            this.applyContainerStyles(container);

            // Build UI using standard DOM APIs
            const title = document.createElement("h3");
            title.textContent = this.name;
            container.appendChild(title);

            const button = document.createElement("button");
            button.textContent = "Click Me";
            // Action on button click
            button.onclick = () => this.doSomething();
            container.appendChild(button);
        }

        /**
         * Optional: Called when the plugin is activated/opened.
         */
        public onActivate() {
            console.log(`${this.name} activated`);
        }

        /**
         * Optional: Called when the plugin is deactivated/closed.
         * Use this for cleanup, like removing event listeners.
         */
        public onDeactivate() {
            console.log(`${this.name} deactivated`);
        }

        /**
         * Example custom method to implement your plugin's logic.
         */
        private doSomething() {
            console.log("Button clicked!");
            
            // Example: Accessing DAWIY state
            const track = this.app.tracksController.selectedTrack;
            if (track) {
                // Access track name via track.element.name
                alert(`Selected track: ${track.element.name}`);
            } else {
                alert("No track selected.");
            }
        }

        /**
         * Helper method to apply basic container styles.
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
    ```

3. **Done:**

    Once you save the file, it will be automatically loaded into DAWIY.

    (`DawiyPluginController` automatically scans for `.ts` files in this directory.)

    

    *Note: `PluginTemplate.ts` and `IDawiyPlugin.ts` are automatically excluded.*



4. **Build/Run:**

    Restart the development server (`npm start` in `public` folder) to see your changes.

    (If already running, it should reload automatically.)

## File Structure

- `IDawiyPlugin.ts`: Defines the interface that all plugins must adhere to.
- `PluginTemplate.ts`: A commented template to help you get started.
- `StochasticGeneratorPlugin.ts`: An example plugin that generates random melodies.

## API & Tips

- You have access to the `App` instance, which gives you control over:
  - `app.tracksController`: Manage tracks, selection, etc.
  - `app.regionsController`: Add/remove regions (notes/audio).
  - `app.host`: Transport control (play/pause, playhead position).
- When modifying state (adding notes, regions, etc.), try to use `app.doIt(undoable, redo, undo)` to support Undo/Redo functionality.
- Keep your UI contained within the `container` passed to `render()`.