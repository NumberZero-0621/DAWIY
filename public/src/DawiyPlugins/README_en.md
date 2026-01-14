# DAWIY Plugin Development Guide

This directory (`public/src/DawiyPlugins`) is the home for custom extensions and plugins for DAWIY.  
Plugins allow you to extend the functionality of the DAW, add new UI tools, generators, or modify the state of the application.

## Getting Started

1. **Create your plugin file:**
    Create a new `.ts` file in this directory or any subdirectory.  
    You can copy `PluginTemplate.ts` as a starting point.  
    *Example:* `public/src/DawiyPlugins/MyAwesomePlugin/MyPlugin.ts`

2. **Implement the interface:**
   Your class must implement the `IDawiyPlugin` interface and be the **default export** of the file.

    ```typescript
    import App from "../../App"; // Adjust path if in subdirectory
    import { IDawiyPlugin } from "../IDawiyPlugin";  // Adjust path if in subdirectory

    export default class MyCoolPlugin implements IDawiyPlugin {
        id = "my-cool-plugin";  // Must be unique across all plugins
        
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
            btn.onclick = () => alert("Hello from MyCoolPlugin!");
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

3. **Automatic Loading:**  
    **You do NOT need to register existing files.**  
    The system automatically loads all `.ts` files found in `public/src/DawiyPlugins` and its subdirectories.

    *Note: `IDawiyPlugin.ts` and `PluginTemplate.ts` are automatically excluded.*

4. **Build/Run:**

    Restart the development server (`npm start` in `public` folder) if it's not watching for new files, or simply refresh the page if hot-reloading catches the new file.

## For LLMs (AI Assistants) / Third-Party Developers

If you are an AI assistant or a developer creating a plugin, follow these rules to ensure compatibility:

1. **File Location:** Place your plugin file in `public/src/DawiyPlugins/<YourPluginName>/<MainFile>.ts`.
2. **Default Export:** The plugin class **MUST** be the default export (`export default class ...`).
3. **Interface:** The class **MUST** implement `IDawiyPlugin`.
4. **Constructor:** The constructor **MUST** accept `app: App` as the first argument.
5. **Context:** You have access to the `App` instance to manipulate the DAW state.
    - `app.tracksController`: access tracks.
    - `app.host`: access transport (play/pause).
6. **No Manual Registration:** Do not attempt to modify `DawiyPluginController.ts`. Just creating the file is enough.

## API & Tips

- You have access to the `App` instance, which gives you control over:
  - `app.tracksController`: Manage tracks, selection, etc.
  - `app.regionsController`: Add/remove regions (notes/audio).
  - `app.host`: Transport control (play/pause, playhead position).
- When modifying state (adding notes, regions, etc.), try to use `app.doIt(undoable, redo, undo)` to support Undo/Redo functionality.
- Keep your UI contained within the `container` passed to `render()`.

[Return to README at the top](../../../README.md)
