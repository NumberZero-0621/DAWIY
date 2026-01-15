# DAWIY Plugin Development Guide

This directory (`public/src/DawiyPlugins`) is the home for custom extensions and plugins for DAWIY.  
Plugins allow you to extend the functionality of the DAW, add new UI tools, generators, or modify the state of the application.

## Information for Developers and AI Agents

### For AI Agents and Developers seeking detailed technical specifications

For detailed API specifications, implementation rules, and template code, please refer to [`AGENTS_en.md`](./AGENTS_en.md) in the same directory.

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

4. **Build/Run:**
    Restart the development server (`npm start`) if new files are not recognized, or reload the page to see changes.

[Return to README at the top](../../../README.md)
