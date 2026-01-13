# DAWIY Plugin Development Guide

This directory (`public/src/DawiyPlugins`) is the home for custom extensions and plugins for DAWIY.
Plugins allow you to extend the functionality of the DAW, add new UI tools, generators, or modify the state of the application.

## Getting Started

1.  **Create your plugin file:**
    Copy `PluginTemplate.ts` to a new file, e.g., `MyCoolPlugin.ts`.

2.  **Implement the interface:**
    Your class must implement the `IDawiyPlugin` interface.
    ```typescript
    import { IDawiyPlugin } from "./IDawiyPlugin";
    // ... imports

    export default class MyCoolPlugin implements IDawiyPlugin {
        id = "my-cool-plugin"; // Must be unique
        name = "My Cool Plugin";
        description = "Does something cool.";

        constructor(app: App) {
            this.app = app;
        }

        render(container: HTMLElement) {
            // Build your UI here using standard DOM APIs
            const btn = document.createElement("button");
            btn.textContent = "Click Me";
            container.appendChild(btn);
        }
    }
    ```

3.  **Register your plugin:**
    Currently, plugins must be manually registered in the controller.
    Open `public/src/Controllers/DawiyPluginController.ts` and:
    
    a. Import your plugin:
       ```typescript
       import MyCoolPlugin from "../DawiyPlugins/MyCoolPlugin";
       ```
    
    b. Add it to the `installedExtensions` array in the constructor:
       ```typescript
       constructor(app: App) {
           this.app = app;
           this.installedExtensions = [
               new StochasticGeneratorPlugin(app),
               new MyCoolPlugin(app) // <-- Add this line
           ];
       }
       ```

4.  **Build/Run:**
    Restart the development server (`npm start` in `public` folder) to see your changes.

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