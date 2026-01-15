# DAWIY - LLM Context & Developer Guide

**Target Audience:** LLMs (AI Assistants) and Developers new to the codebase.  
**Purpose:** Rapidly understand the codebase structure, key APIs, and common patterns without reading every source file.

---

## 1. Project Overview

**DAWIY** is a web-based Digital Audio Workstation (DAW) forked
from **Wam-Studio**.

- **Core Philosophy:** "DIY DAW" - allowing users to customize their environment and add features easily (like plugins).

## 1. System Architecture

DAWIY consists of two main applications running concurrently:

### A. Client (`public/`) - The DAW

- **Type:** Frontend Single Page Application (SPA).
- **Tech Stack:** TypeScript, Pixi.js (v7), Web Audio API, WebAudioModules (WAM) SDK, Bootstrap 5.
- **Build Tool:** Webpack (`webpack-dev-server` on port 5002).
- **Entry Point:** `public/src/index.ts`.
- **Role:** Handles the UI, Audio Engine, and User Interaction.

### B. Server (`bank/`) - The Resource Host

- **Type:** Backend / Static File Server.
- **Tech Stack:** Node.js, Express.js.
- **Entry Point:** `bank/src/index.js`.
- **Role:**
  - Serves **WAM Plugins** (Audio Effects/Instruments) from `bank/plugins/`.
  - Serves **Audio Assets** (Songs, Loops, Metronome sounds).
  - Handles API routes (Projects, Auth).
  - Hosts **Pedalboard2** (a "Meta-WAM" that acts as a container for other plugins).

---

## 2. Directory Structure & Key Components

### Root Directory

- `run_dev.bat` / `run_dev.sh`: Starts both `public` and `bank` concurrently.
- `package.json`: Minimal root dependency management (mostly workspace scripts).

### `public/` (Frontend)

- `src/App.ts`: The "God Object" (see Section 3).
- `src/Controllers/`: Business logic.
- `src/Views/`: Pixi.js rendering logic.
- `src/Audio/`: Web Audio graph management.
- `src/DawiyPlugins/`: **DAWIY-specific Script Plugins** (TypeScript extensions for the DAW UI/Logic).

### `bank/` (Backend)

- `src/index.js`: Express server setup. Routes static folders (`/plugins`, `/songs`) to local directories.
- `plugins/`: Contains **Faust-generated WAMs** (WebAssembly).
  - Structure: `[PluginName]/[PluginName].js` (loader), `.wasm`, `gui/`.
- `pedalboard2/`: A standalone WAM project that combines multiple WAMs.
- `songs/` & `AudioMetro/`: Static audio assets.

---

## 3. The "God Object": `App` (`public/src/App.ts`)

Almost all logic in the Frontend starts from the `App` class instance.

> **Architectural Note:** While `App` acts as a "God Object" (holding references to everything), it functions primarily as a **Service Locator / Dependency Container**.
>
> - **Rule:** Do **NOT** add heavy business logic to `App.ts`.
> - **Practice:** Use `App` only to wire components together or manage cross-cutting concerns (like Undo/Redo). Delegate actual work to the specific Controllers.

- **Access:** Usually passed into constructors or available as a singleton/context.
- **Key Properties:**
  - `app.tracksController`: Manage Tracks (add, remove, select).
  - `app.regionsController`: Manage Regions (clips on the timeline).
  - `app.pianoRollController`: Manage the MIDI Note editor.
  - `app.host`: Access transport (Play/Stop, BPM, Playhead position).
  - `app.hostController`: Control the host (set loop, move playhead).
  - `app.editorView`: The main timeline visualization.

---

## 4. Key Controllers & APIs (Frontend)

### A. RegionController (`public/src/Controllers/Editor/Region/RegionController.ts`)

Manages the clips (Regions) on the main timeline.

- **Core Functions:**
  - `addRegion(track, region)`: Adds a region to a track.
  - `removeRegion(region)`: Removes a region.
  - `select(region)` / `selection`: Manages selection state.
  - `moveRegion(region, newTrack, newX)`: Moves a region.
  - `splitSelectedRegion()`, `mergeSelectedRegion()`: Editing commands.
- **Key Concepts:**
  - **Ghosting:** Uses "ghost" graphics for drag previews.
  - **Snapping:** Checks `editorView.snapping` and `cellSize` to align to grid.

### B. PianoRollController (`public/src/Controllers/Editor/PianoRoll/PianoRollController.ts`)

Manages the MIDI editing window (Piano Roll).

- **Core Functions:**
  - `open(region)`: Opens the editor for a specific MIDI region.
  - `addNote(noteVal, start, duration)`: Adds a MIDI note.
  - `deleteSelectedNotes()`, `copySelectedNotes()`, `pasteNotes()`: Standard editing.
- **Coordinate System:**
  - X-axis: Time (milliseconds).
  - Y-axis: Pitch (0-127). `y = (127 - note) * NOTE_HEIGHT`.

### C. Host / HostController

Manages the global timeline state.

- `app.host.playhead`: Current position in milliseconds.
- `app.host.transport`: Play/Stop state.
- `RATIO_MILLS_BY_PX`: **CRITICAL CONSTANT**. Converts between Pixels (Screen) and Milliseconds (Audio).
  - `time (ms) = pixels * RATIO_MILLS_BY_PX`
  - `pixels = time (ms) / RATIO_MILLS_BY_PX`

---

## 5. Plugin Ecosystems

There are **two types of plugins** in this project. Do not confuse them.

| Type | Directory | Tech | Purpose |
| :--- | :--- | :--- | :--- |
| **DAWIY Plugins** | `public/src/DawiyPlugins/` | TypeScript | **Scripting/UI Extensions.** Modifies the DAW behavior, adds UI buttons, automates tasks. (The "DIY" part). |
| **WAM Plugins** | `bank/plugins/` | Faust / WASM / JS | **Audio Processing.** DSP effects (Reverb, Delay) and Instruments. Loaded into the Audio Graph. |

---

## 6. Common Coding Patterns

### Undo/Redo

Changes to the state should be wrapped in `app.doIt(undoable, redo, undo)`.

```typescript
this.app.doIt(true, 
    () => { /* Redo/Execute logic */ },
    () => { /* Undo logic */ }
);
```

### Event Handling (Pixi.js)

UI interactions use `FederatedPointerEvent`.

- **Dragging:** Pattern usually involves:
  1. `pointerdown`: Record initial state, set `isDragging = true`, add window/global listeners.
  2. `pointermove` (on global/window): Calculate delta, update visuals (ghosts), apply snapping.
  3. `pointerup`: Commit changes (via `doIt`), cleanup listeners.

---

## 7. Important Data Models

- **Track:** Represents a horizontal lane. Contains a list of `Regions`.
- **Region:** A clip on the timeline.
  - `start`: Start time in ms.
  - `duration`: Length in ms.
  - **Types:**
    - `MIDIRegion`: Contains `midi` (Note data).
    - `SampleRegion`: Contains audio waveform references.
- **MIDINote:**
  - `note`: Pitch (0-127).
  - `pos` / `offset`: Relative start time within the region.
  - `duration`: Length in ms.

---

## 8. Token-Saving Tips for LLMs

- **Don't ask to read `App.ts`** unless necessary. Assume it aggregates controllers.
- **Assume Pixi.js** is used for 2D rendering.
- **Assume `RATIO_MILLS_BY_PX`** is the key for any timeline math.
- **Search target:**
  - UI Layout/Styling -> `View` classes.
  - Logic/Behavior -> `Controller` classes.
  - Data Structure -> `Model` classes.
  - Server Routes -> `bank/src/routes/`.
