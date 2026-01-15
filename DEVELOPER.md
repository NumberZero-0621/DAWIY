# Developer Guide

> **Note:** This is a **living document**. AI Agents are strictly instructed to update this file whenever architectural patterns change, new core components are added, or corrections are needed.

This document is intended for developers who want to understand the internal architecture of DAWIY.

## System Architecture

DAWIY operates as a dual-application system:

1. **Frontend (`public/`)**: The DAW interface and audio engine.
2. **Backend (`bank/`)**: The resource host for plugins and audio files.

### 1. Frontend Architecture (`public/`)

The frontend is a Single Page Application (SPA) built with:

- **TypeScript**: Core language.
- **Pixi.js (v7)**: 2D Rendering Engine (Timeline, Piano Roll).
- **Web Audio API**: Audio synthesis and processing.
- **WAM (WebAudioModules)**: Plugin standard.

#### The "God Object": `App.ts`

Located at `public/src/App.ts`.

- **Role**: Dependency Injection Container / Service Locator.
- **Usage**: Holds references to all major controllers (Tracks, Regions, Host).
- **Rule**: **Do not** write business logic here. Use it to wire components.

#### Key Controllers

Logic is separated into controllers found in `public/src/Controllers/`.

| Controller | Responsibility |
| :--- | :--- |
| `RegionController` | Manages clips (Regions) on the timeline (move, split, merge). |
| `PianoRollController` | Manages the MIDI Note editor window. |
| `HostController` | Manages the global transport (Play, Stop, Loop) and timeline state. |
| `TracksController` | Manages track creation, deletion, and ordering. |

#### Time vs. Pixels

The timeline relies on a critical constant for conversion:

- `RATIO_MILLS_BY_PX`: Defines how many milliseconds of audio correspond to 1 pixel of width.
- Formula: `time_ms = pixels * RATIO_MILLS_BY_PX`

### 2. Backend Architecture (`bank/`)

The backend is a Node.js/Express server.

- **Entry Point**: `bank/src/index.js`
- **Role**:
  - Serves **WAM Plugins** (`bank/plugins/`).
  - Serves **Audio Assets** (`bank/songs/`, `bank/AudioMetro/`).
  - Hosts **Pedalboard2** (`bank/pedalboard2/`).

### 3. Plugin Ecosystem

DAWIY supports two distinct types of extensions:

1. **DAWIY Plugins** (`public/src/DawiyPlugins/`)
    - **Tech**: TypeScript.
    - **Purpose**: Extend the DAW's **UI and Logic** (e.g., add a button to generate random notes).

2. **WAM Plugins** (`bank/plugins/`)
    - **Tech**: Faust, C++, WebAssembly.
    - **Purpose**: **Audio Signal Processing** (Instruments, Effects).
    - **Loading**: Loaded dynamically via the Web Audio Module SDK.

## Data Models

- **Track**: A horizontal lane containing Regions.
- **Region**: A container for audio or MIDI data.
  - `start`: Start time (ms).
  - `duration`: Length (ms).
- **MIDINote**:
  - `note`: MIDI Pitch (0-127).
  - `pos`: Start time relative to the Region start.
  - `duration`: Note length (ms).

## Undo/Redo Pattern

State changes should be wrapped in the command pattern via `App.doIt()`:

```typescript
this.app.doIt(
    true, // isUndoable
    () => { /* Execute/Redo Code */ },
    () => { /* Undo Code */ }
);
```

## Rendering (Pixi.js)

Interaction relies on `FederatedPointerEvent`.

- **Drag & Drop**:
    1. `pointerdown`: Initialize drag.
    2. `pointermove` (Global): Update position/ghosts.
    3. `pointerup`: Commit change.
