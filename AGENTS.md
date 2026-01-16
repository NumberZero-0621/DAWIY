# AGENTS.md

> **Mission:** Use this document as one of the sources of information about the architectural context, project structure, and operational constraints in the development of DAWIY.

## 1. Project Overview

**DAWIY** is a web-based Digital Audio Workstation (DAW) forked from Wam-Studio.

- **Philosophy:** "DIY DAW" - Extensible and user-customizable.
- **Architecture:** Monorepo with two concurrent applications (Client & Server).

## 2. Directory Structure & Map

### Root Map

- `public/`: **Frontend Application** (SPA, UI, Audio Engine).
- `bank/`: **Backend Server** (Static resources, WAM host).
- `run_dev.cmd` / `run_dev.sh`: Development entry point (runs both apps).

### Frontend Structure (`public/`)

- **Frameworks:** TypeScript, Pixi.js (v7), Web Audio API, Bootstrap 5.
- **Entry:** `src/index.ts`
- **Key Paths:**
  - `src/App.ts`: **Dependency Container** (See Section 3).
  - `src/Controllers/`: **Business Logic** (Track manipulation, Audio graph).
  - `src/Views/`: **Rendering Logic** (Pixi.js components, DOM manipulation).
  - `src/DawiyPlugins/`: **UI/Script Plugins** (TypeScript extensions).

### Backend Structure (`bank/`)

- **Frameworks:** Node.js, Express.js.
- **Entry:** `src/index.js`
- **Key Paths:**
  - `plugins/`: **WAM Plugins** (Faust/WASM DSP modules).
  - `songs/` & `AudioMetro/`: Static audio assets.
  - `pedalboard2/`: Standalone "Meta-WAM" host.

## 3. Architectural Constraints & Patterns

### The "God Object" Rule (`App.ts`)

`public/src/App.ts` is a **Service Locator**, not a logic handler.

- **DO NOT** add business logic to `App.ts`.
- **DO** use `App` to inject dependencies into Controllers or Views.
- **DO** use `App` to access global instances (`app.host`, `app.tracksController`).

### Controller Pattern

Business logic resides in `public/src/Controllers/`.

- **RegionController:** Manages timeline clips (move, split, merge).
- **PianoRollController:** Manages MIDI editing (notes, velocity).
- **HostController:** Manages Transport (Play/Stop/Loop) and Global Playhead.

### Coordinate System (Time vs. Pixels)

The timeline conversion is governed by `RATIO_MILLS_BY_PX`.

- **Formula:** `time_ms = pixels * RATIO_MILLS_BY_PX`
- **Context:** When implementing UI dragging or rendering timeline elements, ALWAYS use this ratio.

### Undo/Redo

All state-modifying actions must be wrapped in `app.doIt()`:

```typescript
this.app.doIt(
  true, // isUndoable
  () => { /* Redo/Execute logic */ },
  () => { /* Undo logic */ }
);
```

### Plugin Distinction

- **DawiyPlugin (`public/src/DawiyPlugins/`):** TypeScript. Modifies DAW UI/Behavior.
- **WAM Plugin (`bank/plugins/`):** WASM/Faust. Processes Audio Signals.

## 4. Git Policy

- **Manual Control:** **DO NOT** perform `git commit`, `git push`, or any destructive Git operations autonomously.
- **Requirement:** Wait for a direct instruction (or a strong suggestion) from the user before committing changes. Do not commit "for the user's convenience" without asking.

## 5. Development Commands

- **Start Dev Server:** `npm run dev` or `run_dev.cmd` (Windows) / `run_dev.sh` (Unix).
  - Starts Client on port `5002`.
  - Starts Server on port `6002`.
- **Build Client:** `cd public && npm run build`
- **Install Dependencies:** `npm install` (Root), `cd public && npm install`, `cd bank && npm install`.
- **Run Tests:** `cd public && npm test`
  - Runs Jest unit tests. New features should be tested where possible.

## 5. Token Optimization Strategy

- **Search First:** Use file search to locate specific `Controller` or `View` files rather than reading generic entry points.
- **Assumptions:**
  - Assume standard Pixi.js v7 syntax for graphics.
  - Assume Web Audio API standard node connections.

## 6. Self-Maintenance Protocol

**CRITICAL:** `AGENTS.md` and `DEVELOPER.md` are **living documents**.

- **When to Update:**
  1. **Architectural Shifts:** If you implement a major feature that changes the system structure.
  2. **Error Recovery:** If you encounter a bug caused by following outdated instructions here, **fix the documentation** after fixing the code.
  3. **Discovery:** If you find a hidden convention or "gotcha" that is not documented but essential, record it here immediately.
- **Goal:** Treat these files as the project's long-term memory. Do not wait for user permission to improve the documentation of the system's internal workings.
