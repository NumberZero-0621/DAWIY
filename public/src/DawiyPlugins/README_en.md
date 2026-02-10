# DAWIY Plugin Development Guide

This directory (`public/src/DawiyPlugins`) is the home for custom extensions and plugins for DAWIY.  
Plugins allow you to extend the functionality of the DAW, add new UI tools, generators, or modify the state of the application.

## Information for Developers and AI Agents

### For AI Agents and Developers seeking detailed technical specifications

For detailed API specifications, implementation rules, and template code, please refer to [`AGENTS_en.md`](./AGENTS_en.md) in the same directory.
In particular, new specifications for `HostAPI` (UI extensions, file access, I/O hooks) are described.

## Getting Started (Quick Start)

1. **Create your plugin file:**
    Create a new `.ts` file in this directory or any subdirectory.  
    We recommend copying `PluginTemplate.ts` to get started.  
    *Example:* `public/src/DawiyPlugins/MyAwesomePlugin/MyPlugin.ts`

2. **Implement the interface:**
   Your class must implement the `IDawiyPlugin` interface and be the **default export** of the file.

    ```typescript
    // Basic Example
    import App from "../../App"; 
    import { IDawiyPlugin } from "../IDawiyPlugin";

    export default class MyPlugin implements IDawiyPlugin {
        id = "my-plugin";
        name = "My Plugin";
        description = "Sample Plugin";
        // ... (See AGENTS_en.md or PluginTemplate.ts for details)
    }
    ```

3. **Done:**  
    **Manual registration is not required.**  
    The system automatically detects and loads all `.ts` files found in `public/src/DawiyPlugins` and its subdirectories.

    *Note: `PluginTemplate.ts` and `IDawiyPlugin.ts` are automatically excluded.*

4. **Plugin Creator (Recommended):**
    DAWIY includes a built-in plugin generation tool.
    * **Access:** "Create Plugin" tab in the Plugin Manager (Menu > DAWIY Plugin).
    * **Features:**
        * **Form Input:** Enter Name, Class Name, and Dependencies to generate a ZIP.
        * **Drag & Drop:** Drop an existing `.ts` file to automatically parse and fill class name and `import` statements.
    * **Output:** Downloads a ZIP file containing `plugin.json` (config) and `.ts` (source code).

5. **Using External Libraries:**
    To use third-party libraries (e.g., `tonal`, `lodash`), specify the CDN URL in the `dependencies` field of `plugin.json`.

    * **How to specify:** Enter the URL in the "Dependencies" field of the Plugin Creator (one per line).
    * **Mechanism:** The system automatically injects `<script>` tags to load the libraries before loading the plugin.

    > See [`AGENTS_en.md`](./AGENTS_en.md) for detailed specifications.

6. **Build/Run:**
    Restart the development server (`npm start`) if new files are not recognized, or reload the page to see changes.

[Return to README at the top](../../../README.md)
