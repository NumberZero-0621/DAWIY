# DAWIY Plugin Development Guide

This directory (`public/src/DawiyPlugins`) is the home for custom extensions and plugins for DAWIY.
Plugins allow you to extend the functionality of the DAW, add new UI tools, generators, or modify the state of the application.

## Getting Started

1.  **Create your plugin file:**
    Create a new `.ts` file in this directory or any subdirectory. 
    You can copy `PluginTemplate.ts` as a starting point.
    *Example:* `public/src/DawiyPlugins/MyAwesomePlugin/MyPlugin.ts`

2.  **Implement the interface:**
    Your class must implement the `IDawiyPlugin` interface and be the **default export** of the file.

    ```typescript
    import { IDawiyPlugin } from "../IDawiyPlugin"; // Adjust path if in subdirectory
    import App from "../../App"; // Adjust path if in subdirectory

    export default class MyCoolPlugin implements IDawiyPlugin {
        id = "my-cool-plugin"; // Must be unique across all plugins
        name = "My Cool Plugin";
        description = "Does something cool.";

        private app: App;

        constructor(app: App) {
            this.app = app;
        }

        render(container: HTMLElement) {
            // Build your UI here using standard DOM APIs
            const btn = document.createElement("button");
            btn.textContent = "Click Me";
            btn.onclick = () => alert("Hello from MyCoolPlugin!");
            container.appendChild(btn);
        }
    }
    ```

3.  **Automatic Loading:**
    **You do NOT need to register existing files.** 
    The system automatically loads all `.ts` files found in `public/src/DawiyPlugins` and its subdirectories.
    
    *Note: `IDawiyPlugin.ts` and `PluginTemplate.ts` are automatically excluded.*

4.  **Build/Run:**
    Restart the development server (`npm start` in `public` folder) if it's not watching for new files, or simply refresh the page if hot-reloading catches the new file.

## For LLMs (AI Assistants) / Third-Party Developers

If you are an AI assistant or a developer creating a plugin, follow these rules to ensure compatibility:

1.  **File Location:** Place your plugin file in `public/src/DawiyPlugins/<YourPluginName>/<MainFile>.ts`.
2.  **Default Export:** The plugin class **MUST** be the default export (`export default class ...`).
3.  **Interface:** The class **MUST** implement `IDawiyPlugin`.
4.  **Constructor:** The constructor **MUST** accept `app: App` as the first argument.
5.  **Context:** You have access to the `App` instance to manipulate the DAW state.
    - `app.tracksController`: access tracks.
    - `app.host`: access transport (play/pause).
6.  **No Manual Registration:** Do not attempt to modify `DawiyPluginController.ts`. Just creating the file is enough.

## API & Tips

- You have access to the `App` instance, which gives you control over:
  - `app.tracksController`: Manage tracks, selection, etc.
  - `app.regionsController`: Add/remove regions (notes/audio).
  - `app.host`: Transport control (play/pause, playhead position).
- When modifying state (adding notes, regions, etc.), try to use `app.doIt(undoable, redo, undo)` to support Undo/Redo functionality.
- Keep your UI contained within the `container` passed to `render()`.