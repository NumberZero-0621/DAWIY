import songs from "../../static/songs.json";
import App from "../App";
import WebAudioPeakMeter from "../Audio/Utils/PeakMeter";
import VuMeter from "../Components/VuMeterElement";
import { setTempo, SONGS_FILE_URL, ZOOM_LEVEL } from "../Env";
import DraggableWindow from "../Utils/DraggableWindow";
import HostView from "../Views/HostView";
import { audioCtx } from "../index";
import JSZip from "jszip";

/**
 * Class to control the audio. It contains all the listeners for the audio controls.
 * It also contains the audio context and the list of tracks. It is used to play, pause, record, mute, loop, etc.
 */
export default class HostController {
  /**
   * Vu meter of the master track.
   */
  public vuMeter: VuMeter;

  /**
   * Route application.
   */
  private _app: App;
  /**
   * View of the host.
   */
  private _view: HostView;
  /**
   * List of draggable windows.
   */
  private windows: DraggableWindow[];

  /**
   * Active HTML element when scrolling.
   */
  private active: EventTarget | null;
  /**
   * Boolean to know if the timer interval is paused.
   */
  private _timerIntervalPaused: boolean;
  /**
   * Interval to update the timer.
   */
  private _timerInterval: any | undefined;
  /**
   * Interval time to update the vu meter.
   */
  private readonly TIMER_INTERVAL_MS = 1000 / 60; // 60 fps

  constructor(app: App) {
    this._app = app;
    this._view = app.hostView;
    this.windows = [];
    this._timerIntervalPaused = false;

    this._view.host?.append(this._app.host.element)
    this._app.host.element.name = "Master Track"
    this._app.tracksController.bindSoundProviderEvents(this._app.host)

    this.initializeDemoSongs();
    this.initializeVuMeter();
    this.bindEvents();
    this.bindNodeListeners();
    this.bindResizerEvents();
    this._app.host.metronomeOn = false;  // Metronome is off by default
    console.log("Initial Metronome State: " + (this._app.host.metronomeOn ? "On" : "Off"));
    this._view.updateMetronomeBtn(false);

    this.refreshHamburgerMenu(); // Initial render based on config

    this._app.host.onPlayHeadMove.add((playhead) => {
      // TODO Move the metronome to the new playhead position
    })
  }

  public refreshHamburgerMenu() {
    import("../Utils/MenuConfig").then(({ MenuConfig }) => {
      const config = MenuConfig.load();
      const hamburgerMenu = document.getElementById("main-hamburger-menu");
      if (!hamburgerMenu) return;

      // Dividers handling (simple approach: keep them static or manage them dynamically too)
      // For now, let's just reorder the known containers.
      // We need to detach them first or just appendChild/insertBefore to move them.

      const fragment = document.createDocumentFragment();
      const dividers = {
        div1: document.getElementById("menu-divider-1"),
        div2: document.getElementById("menu-divider-2"),
        div3: document.getElementById("menu-divider-3")
      };

      // Helper to append item
      const appendItem = (id: string, domId: string) => {
        const el = document.getElementById(domId);
        if (el) {
          if (config.find(c => c.id === id)?.visible) {
            el.style.display = ""; // Reset display
            fragment.appendChild(el);
          } else {
            el.style.display = "none"; // Hide but keep in DOM (moved to end later?) or just don't append?
            // If we don't append, it's removed from view but we need reference.
            // Better to append but hide.
            fragment.appendChild(el);
          }
        }
      };

      // Custom logic to interleave dividers if needed.
      // Based on original order:
      // select_demo
      // DIVIDER 1
      // load_project
      // save_project
      // export_project
      // import
      // DIVIDER 2
      // settings
      // dawiy_plugin
      // DIVIDER 3
      // about

      // If we strictly follow user order, dividers become tricky.
      // Requirement: "そのウィンドウでは各メニューをドラッグアンドドロップすることができ、それによって実際のハンバーガーメニューでのメニューの並び順も変更することが出来る"
      // This implies full reordering. Dividers might look weird or should be removed/moved.
      // Let's assume dividers separate "groups" originally, but if user reorders, groups might dissolve.
      // For simplicity/robustness: Remove fixed dividers if order is customized?
      // Or just ignore dividers for the reordered list and append them at the end or remove them.
      // Let's hide dividers if order is not default? Or just remove them for now to simplify.

      // Better: Just append items in config order.
      config.forEach(item => {
        const el = document.getElementById(item.domId);
        if (el) {
          if (item.visible) {
            el.style.display = "";
            fragment.appendChild(el);
          } else {
            el.style.display = "none";
            fragment.appendChild(el);
          }
        }
      });

      // Append others (inputs etc)
      const inputs = [
        document.getElementById("new-track-input"),
        document.getElementById("new-midi-track-input"),
        document.getElementById("dawproject-input")
      ];
      inputs.forEach(el => { if (el) fragment.appendChild(el); });

      // Put fragment content back to menu
      hamburgerMenu.innerHTML = ""; // Be careful with event listeners...
      // wait, clearing innerHTML destroys elements and their listeners if they were not moved.
      // Since we got references via getElementById, if we move them they remain alive.
      // But if we clear innerHTML, we might lose things we didn't capture.
      // Safe way: appendChild moves the element.

      hamburgerMenu.appendChild(fragment);

      // Hide dividers for now as they don't fit into the sortable logic easily without being sortable themselves.
      Object.values(dividers).forEach(d => {
        if (d) d.style.display = "none";
      });
    });
  }

  /**
   * Start playing the audio. It also starts the metronome if it's enabled.
   * @param inRecordingMode - Boolean to know if the button is a stop button or not when recording.
   */
  public play(): void {
    const host = this._app.host
    if (!host.isPlaying) {
      this._app.automationController.applyAllAutomations();
      if (host.modified) {
        host.update(audioCtx)
        host.modified = false
      }
      host.play()
      this.launchTimerInterval();
      if (host.metronomeOn) this._view.metronome.start(host.playhead);
      this._view.updatePlayButton(true, host.recording)
    }
  }

  /**
   * Stop playing the audio.
   */
  stop() {
    const host = this._app.host
    if (host.isPlaying) {
      this._app.tracksController.tracks.forEach((track) => {
        if (track.plugin && track.plugin.instance) track.plugin.instance?.audioNode?.clearEvents()
      })

      // ストリーミングを停止
      this._app.automationController.stopAutomationStreaming();

      host.pause()
      if (this._app.recorderController.isRecording) this._app.recorderController.stopRecordingAll()
      if (this._timerInterval) clearInterval(this._timerInterval)
      this._view.metronome.stop()
      this._view.updatePlayButton(false, host.recording)
    }
  }

  /**
   * Handles the back button. It goes back to the beginning of the song.
   */
  public back(): void {
    this._app.host.playhead = 0;
    this._app.automationController.applyAllAutomations();

    // recenter viewport at center of current viewport width
    const pos = this._app.editorView.editorDiv.clientWidth / 2;
    //console.log("width = " + this._app.editorView.editorDiv.clientWidth);
    this._app.editorView.viewport.moveCenter(
      pos,
      this._app.editorView.viewport.center.y
    );
    // need to reposition the custom scrollbar too...
    // adjust horizontal scrollbar
    this._app.editorView.horizontalScrollbar.moveToBeginning();
  }


  public toggleMetronome(): void {
    const metronomeOn = !this._app.host.metronomeOn;
    console.log("Metronome Toggled: " + (metronomeOn ? "On" : "Off"));
    this._app.host.metronomeOn = metronomeOn;

    // Log the state change
    console.log(`Metronome ${metronomeOn ? "started" : "stopped"}`);

    // Start or stop the metronome based on both metronome state and whether playback is active
    if (this._app.host.isPlaying) {
      if (metronomeOn) this._view.metronome.start(this._app.host.playhead);
      else this._view.metronome.stop();
    }

    // Update the icon to reflect the new state.
    this._view.updateMetronomeBtn(metronomeOn);
  }


  public snapOnOff(): void {
    const snapping = !this._app.editorView.snapping;
    this._app.editorView.snapping = snapping;

    this._view.updateSnapButton(snapping);
  }

  /** Handles the loop button. It loops the song or not. */
  public loop(): void {
    const looping = !this._app.host.loopRange;
    this._view.updateLoopButton(looping);
    this._app.editorView.loop.updateActive(looping);

    if (looping) {
      const selectedRange = this._app.playheadController.getRangePx();
      if (selectedRange) {
        this._app.loopController.moveLoopToSelection(selectedRange.start, selectedRange.end);
      }
      // Activate loop on the host with the current range (updated or default)
      this._app.host.setLoop(this._loopRange);
    } else {
      // Deactivate loop
      this._app.host.setLoop(null);
    }

    if (this._app.pianoRollController) this._app.pianoRollController.updateLoop(looping);
  }

  /**
   * Updates the loop value of the host. It is called when the user changes the loop value.
   *
   * @param range - Time of the left and right of the loop in milliseconds.
   */
  public setLoop(range: [number, number]): void {
    this._loopRange = range
    if (this._app.host.loopRange) this._app.host.setLoop(range)
    if (this._app.pianoRollController) this._app.pianoRollController.updateLoopRange(range);
  }
  private _loopRange: [number, number] = [0, 0]
  get loopRange(): [number, number] { return this._loopRange }

  /**
   * Handles the import of files by the browser. It creates a new track for each file.
   *
   * @param e - Input event of the file input.
   */
  public importFilesSongs(e: InputEvent): void {
    const target = e.target as HTMLInputElement;

    if (target.files) {
      for (let i = 0; i < target.files.length; i++) {
        let file = target.files[i];
        if (file !== undefined) {
          this._app.tracksController.createTrackWithFile(file).then((track) => {
          });
        }
      }
    }
  }

  /**
   * Handles the import of MIDI files.
   *
   * @param e - Input event of the file input.
   */
  public importMidiFiles(e: InputEvent): void {
    const target = e.target as HTMLInputElement;

    if (target.files) {
      for (let i = 0; i < target.files.length; i++) {
        let file = target.files[i];
        if (file !== undefined) {
          this._app.tracksController.createTrackWithMidiFile(file);
        }
      }
    }
  }

  /**
   * Handles the loading of .dawproject files.
   *
   * @param e - Input event of the file input.
   */
  public async loadDawProject(e: InputEvent): Promise<void> {
    const target = e.target as HTMLInputElement;
    if (target.files && target.files[0]) {
      const file = target.files[0];
      try {
        const arrayBuffer = await file.arrayBuffer();
        const zip = await JSZip.loadAsync(arrayBuffer);

        // We will implement DawProjectLoader to handle the rest
        const { default: DawProjectLoader } = await import("../Loader/DawProjectLoader");
        const loader = new DawProjectLoader(this._app);
        await loader.load(zip);
      } catch (err) {
        console.error("Failed to load dawproject:", err);
        alert("Failed to load .dawproject file. See console for details.");
      } finally {
        target.value = ""; // Clear input for next time
      }
    }
  }

  public async saveDawProject(): Promise<void> {
    try {
      const { default: DawProjectExporter } = await import("../Loader/DawProjectExporter");
      const exporter = new DawProjectExporter(this._app);
      await exporter.export();
    } catch (err) {
      console.error("Failed to save dawproject:", err);
      alert("Failed to save .dawproject file. See console for details.");
    }
  }

  /**
   * Binds the events of the host node.
   */
  public bindNodeListeners(): void {
    /*if (this._app.host.hostNode) {
      const prev=this._app.host.hostNode.port.onmessage
      this._app.host.hostNode.port.onmessage = (ev) => {
        if (ev.data.volume >= 0) {
          let vol = ev.data.volume;
          let sensitivity = 2.3;
        }
      };
    } else {
      console.warn("Host node not initialized.");
    }*/
  }

  /**
   * Pauses the timer interval. Used when the user is jumping to a specific beat.
   */
  public pauseTimerInterval(): void {
    this._timerIntervalPaused = true;
  }

  /**
   * Resumes the timer interval. Used when the user is jumping to a specific beat.
   */
  public resumeTimerInterval(): void {
    this._timerIntervalPaused = false;
  }

  /**
   * Stops all the tracks.
   */
  public stopAllTracks(): void {
    this._app.host.pause()
  }

  /**
   * Adds draggable windows to the host.
   * @param windows - Windows to add.
   */
  public addDraggableWindow(...window: DraggableWindow[]): void {
    this.windows.push(...window);
    this.windows.forEach((win) => {
      win.resizableWindow.addEventListener("mousedown", () => {
        this.focus(win);
      });
    });
  }

  /**
   * Focus the window passed in parameter.
   * @param window - Window to focus.
   */
  public focus(window: DraggableWindow): void {
    for (const win of this.windows) {
      win.resizableWindow.style.zIndex =
        win.resizableWindow === window.resizableWindow ? "100" : "99";
    }
  }

  public onPlayButton() {
    if (!this._app.host.isPlaying) this._app.hostController.play()
    else this._app.hostController.stop()
  }

  public onRecordButton() {
    if (!this._app.recorderController.isRecording) {
      this._app.recorderController.startRecordingAll()
      this._app.hostController.play()
    }
    else this._app.recorderController.stopRecordingAll()
  }

  public switchToSelectMode(): void {
    App.TOOL_MODE = "SELECT";
    this._view.updateToolIcon("SELECT");
    this._view.toolMenu.style.display = "none";
  }

  public switchToPenMode(): void {
    App.TOOL_MODE = "PEN";
    this._view.updateToolIcon("PEN");
    this._view.toolMenu.style.display = "none";
  }

  /**
   * Binds the events of the host.
   * @private
   */
  private bindEvents(): void {
    // detect global click on the document and resume the audio context if necessary
    document.addEventListener("click", () => {
      if (audioCtx.state === "suspended") {
        console.log("RESUMING AUDIO CONTEXT");
        audioCtx.resume();
      }
    });
    // TOP BAR CONTROLS
    this._view.backBtn.addEventListener("click", () => {
      this.back();
    });

    this._view.playBtn.addEventListener("click", () => this.onPlayButton());

    this._view.recordBtn.addEventListener("click", () => this.onRecordButton());

    this._view.loopBtn.addEventListener("click", () => {
      this.loop();
    });
    this._view.muteBtn.addEventListener("click", () => {
      this._app.host.isMuted = !this._app.host.isMuted
      this._view.updateMuteButton(this._app.host.isMuted)
    });
    this._view.metroBtn.addEventListener("click", () => {
      this.toggleMetronome();
    });
    this._view.snapBtn.addEventListener("click", () => {
      this.snapOnOff();
    });

    // Tool Button Logic
    const toggleToolMenu = () => {
      const display = this._view.toolMenu.style.display;
      this._view.toolMenu.style.display = display === "none" ? "block" : "none";
    };
    this._view.toolBtn.addEventListener("click", toggleToolMenu);

    this._view.toolSelectBtn.addEventListener("click", () => {
      this.switchToSelectMode();
    });

    this._view.toolPenBtn.addEventListener("click", () => {
      this.switchToPenMode();
    });

    // Hide tool menu on outside click
    window.addEventListener("click", (e) => {
      if (!this._view.toolMenu.contains(e.target as Node) &&
        !this._view.toolBtn.contains(e.target as Node)) {
        this._view.toolMenu.style.display = "none";
      }
    });

    this._view.metronomeContainer.hidden = true
    this._view.metronomeArrow?.addEventListener("click", () => {
      this._view.metronomeContainer.hidden = !this._view.metronomeContainer.hidden
    })

    this._view.splitBtn.addEventListener("click", () => {
      this._app.regionsController.splitSelectedRegion();
    });

    this._view.mergeBtn.addEventListener("click", () => {
      this._app.regionsController.mergeSelectedRegion();
    });

    // undo/redo
    // with cdm/ctl-z or cmd-ctrl-shift-z
    document.addEventListener("keydown", (e: KeyboardEvent) => {
      // Replaced with ShortcutController
      if (this._app.shortcutController.isTriggered("edit.undo", e)) {
        this._app.undoManager.undo();
        this._app.hostView.setUndoButtonState(this._app.undoManager.hasUndo());
        this._app.hostView.setRedoButtonState(this._app.undoManager.hasRedo());
        return;
      }
      if (this._app.shortcutController.isTriggered("edit.redo", e)) {
        this._app.undoManager.redo();
        this._app.hostView.setUndoButtonState(this._app.undoManager.hasUndo());
        this._app.hostView.setRedoButtonState(this._app.undoManager.hasRedo());
        return;
      }
      if (this._app.shortcutController.isTriggered("tool.select", e)) {
        e.preventDefault();
        this.switchToSelectMode();
        return;
      }
      if (this._app.shortcutController.isTriggered("tool.pen", e)) {
        e.preventDefault();
        this.switchToPenMode();
        return;
      }
    });

    // with clicks on undo/redo buttons
    this._view.undoBtn.addEventListener("click", () => {
      this._app.undoManager.undo();
      this._app.hostView.setUndoButtonState(this._app.undoManager.hasUndo());
      this._app.hostView.setRedoButtonState(this._app.undoManager.hasRedo());
    });
    this._view.redoBtn.addEventListener("click", () => {
      this._app.undoManager.redo();

      this._app.hostView.setUndoButtonState(this._app.undoManager.hasUndo());
      this._app.hostView.setRedoButtonState(this._app.undoManager.hasRedo());
    });

    // ZOOM BUTTONS
    this._view.zoomInBtn.addEventListener("click", async () => {
      this._app.editorController.zoomTo(ZOOM_LEVEL * 1.5);
    });
    this._view.zoomOutBtn.addEventListener("click", async () => {
      this._app.editorController.zoomTo(ZOOM_LEVEL / 1.5);
    });

    // ZOOM INPUT
    this._app.editorView.spanZoomLevel.addEventListener("change", () => {
      let val = parseFloat(this._app.editorView.spanZoomLevel.value);
      if (isNaN(val)) val = 1;
      this._app.editorController.zoomTo(val);
    });

    // Tempo and Time Signature selectors
    this._view.timeSignatureSelector.on_change.add(([numerator, denominator]) => {
      this._app.editorView.grid.updateTimeSignature(numerator, denominator)
      this._app.hostView.metronome.timeSignature = [numerator, denominator]
      this._app.hostView.metronome.playhead = this._app.host.playhead
      this._app.pianoRollController.redraw(); // Update Piano Roll Grid
    })

    this._view.tempoSelector.on_change.add((newTempo) => {
      if (newTempo < 5 || newTempo > 600) {
        this._view.tempoSelector.tempo = Math.max(5, Math.min(600, newTempo))
        return
      }
      this._app.hostView.metronome.tempo = newTempo
      setTempo(newTempo)
      this._app.playheadController.moveTo(this._app.host.playhead, false)

      // redraw all tracks according to new tempo
      this._app.tracksController.tracks.forEach((track) => {
        // redraw all regions taking into account the new tempo
        // RATIO_MILLS_BY_PX has been updated by updateTemponew(Tempo)
        // for all track regions, update their start properties
        for (const region of track.regions) {
          // TEMPO_DELTA (that represents the ration newTempo/oldTempo) has been updated
          // region pos should not change when the tempo changes
          // a region that starts at 2000ms at 120bpm, when tempo changes to 60bpm
          // should now start at 2000/TEMPO_DELTA, in other words 2000/0.5 = 4000ms
          // TODO: Useful for what ? region.start=region.start / TEMPO
        }

        track.modified = true

        this._app.editorView.drawRegions(track);
      });
    })

    // MENU BUTTONS
    this._view.exportProject.addEventListener("click", () => {
      this._app.projectController.openExportWindow('AUDIO');
      this.focus(this._app.projectView);
    })
    this._view.exportMidi.addEventListener("click", () => {
      this._app.projectController.openExportWindow('MIDI');
      this.focus(this._app.projectView);
    })
    this._view.saveBtn.addEventListener("click", () => {
      this._app.projectController.openSaveWindow();
      this.focus(this._app.projectView);
    })
    this._view.saveDawProjectBtn.addEventListener("click", () => {
      this.saveDawProject();
    })
    this._view.loadBtn.addEventListener("click", () => {
      this._app.projectController.openLoadWindow();
      this.focus(this._app.projectView);
    })
    this._view.loadDawProjectBtn.addEventListener("click", () => {
      this._view.dawprojectInput.click();
    });
    this._view.dawprojectInput.addEventListener("change", (e) => {
      this.loadDawProject(e as InputEvent);
    });

    this._view.settingsBtn.addEventListener("click", () => {
      this._app.settingsController.openSettings();
      this.focus(this._app.settingsView);
    })
    this._view.dawiyPluginBtn.addEventListener("click", () => {
      this._app.dawiyPluginController.openWindow();
      this.focus(this._app.dawiyPluginView);
    })

    this._view.aboutBtn.addEventListener("click", () => {
      this._view.aboutWindow.hidden = false;
      this.focus(this._app.aboutView);
    })
    this._view.aboutCloseBtn.addEventListener("click", () => {
      this._view.aboutWindow.hidden = true;
    })


    this._view.keyboardShortcutsCloseBtn.addEventListener("click", () => {
      this._view.keyboardShortcutsWindow.hidden = true;
    })


    this._view.importSongs.addEventListener("click", () => {
      this._view.newTrackInput.click();
    });
    this._view.newTrackInput.addEventListener("change", (e) => {
      this.importFilesSongs(e as InputEvent);
    });
    this._view.importMidi.addEventListener("click", () => {
      this._view.newMidiTrackInput.click();
    });
    this._view.newMidiTrackInput.addEventListener("change", (e) => {
      this.importMidiFiles(e as InputEvent);
    });

    // SCROLL SYNC
    const trackDiv = this._app.tracksView.trackContainerDiv;
    trackDiv.addEventListener("mouseenter", (e: MouseEvent) => { this.active = e.target; });

    trackDiv.addEventListener("scroll", (e: Event) => {
      if (e.target !== this.active) return
      this._app.editorView.verticalScrollbar.customScrollTop(trackDiv.scrollTop)
    });
  }

  /**
   * Binds the events of the vertical resizer to allow dragging.
   * @private
   */
  private bindResizerEvents(): void {
    const resizer = document.getElementById('vertical-resizer') as HTMLDivElement;
    const pluginEditor = document.getElementById('plugin-editor') as HTMLDivElement;
    const pluginsView = this._app.pluginsView;

    const mouseMoveHandler = (e: MouseEvent) => {
      // Calculate the new height based on mouse position from the bottom of the viewport
      const newHeight = window.innerHeight - e.clientY - (resizer.offsetHeight / 2);

      // Define boundaries for resizing
      const minHeight = 25; // Collapsed height
      const maxHeight = window.innerHeight - 200; // Leave at least 200px for the top editor

      const clampedHeight = Math.max(minHeight, Math.min(newHeight, maxHeight));

      pluginEditor.style.height = `${clampedHeight}px`;
      pluginEditor.style.minHeight = `${clampedHeight}px`; // Ensure minHeight is also set

      // Trigger the main editor canvas resize
      this._app.editorView.resizeCanvas();
    };

    const mouseUpHandler = () => {
      document.removeEventListener('mousemove', mouseMoveHandler);
      document.removeEventListener('mouseup', mouseUpHandler);
      document.body.style.cursor = 'default';
      document.body.style.userSelect = 'auto';

      // Store the new height for when the panel is maximized again
      const currentHeight = pluginEditor.offsetHeight;
      if (currentHeight > 30) { // Only store if not collapsed
        pluginsView.lastUserHeight = currentHeight;
      }
    };

    resizer.addEventListener('mousedown', (e) => {
      e.preventDefault();

      // If the panel is currently collapsed, maximizing it should be done by the dedicated button
      // Or we can decide to let the drag maximize it. Let's do that.

      document.addEventListener('mousemove', mouseMoveHandler);
      document.addEventListener('mouseup', mouseUpHandler);
      document.body.style.cursor = 'row-resize';
      document.body.style.userSelect = 'none';
    });
  }

  /**
   * Initializes the demo songs. It creates a new song item for each demo song present in the json file.
   * @private
   */
  private initializeDemoSongs(): void {
    songs.forEach((song) => {
      let name = song.name;
      let el = this._view.createNewSongItem(name);
      el.onclick = async () => {
        this._app.tracksController.clearTracks();
        for (let trackSong of song.songs) {
          const url = SONGS_FILE_URL + trackSong;
          let track = await this._app.tracksController.createTrack(url);
          this._app.loader.loadTrackUrl(track, url);
        }
      };
    });
  }

  /**
   * Initializes the timer interval. It updates the timer and the playhead position.
   * @private
   */
  private launchTimerInterval(): void {
    let lastPos = this._app.host.playhead;
    this._timerInterval = setInterval(() => {
      let newPos = this._app.host.playhead;
      if (lastPos !== newPos) {
        lastPos = newPos;
        if (!this._timerIntervalPaused) {
          this._view.updateTimer(newPos);
        }
      }
    }, this.TIMER_INTERVAL_MS);
  }

  /**
   * Initializes the vu meter. It creates a new vu meter for the master track.
   * @private
   */
  private initializeVuMeter(): void {
    let peakMeter = new WebAudioPeakMeter(
      audioCtx,
      this._app.host.outputNode,
      this._app.host.element.getPeakMeterParentElement(),
      {
        borderSize: 2,
        fontSize: 7, // tick fontSize. If zero -> no ticks, no labels etc.
        backgroundColor: "#1C1E21",
        tickColor: "#ddd",
        labelColor: "#ddd",
        gradient: ["red 1%", "#ff0 16%", "lime 45%", "#080 100%"],
        dbRange: 48,
        dbTickSize: 6,
        maskTransition: "0.1s",
      }
    );
    // MB replaced by another vu-meter
    //this.vuMeter = new VuMeter(this._view.vuMeterCanvas, 30, 157);

    // create vu-meter. Wait until parent is visible.

  }
}
