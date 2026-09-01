import { DAWIYPlugin } from "../IDawiyPlugin";
import DawiyPluginBase from "../DawiyPluginBase";
import App from "../../App";
import HostAPI from "../API/HostAPI";

import { GameLogic } from "./GameLogic";
import { ChatEngine } from "./ChatEngine";
import { CharacterUI } from "./CharacterUI";
import MIDIRegion from "../../Models/Region/MIDIRegion";
import { MIDI, MIDINote } from "../../Audio/MIDI/MIDI";
import { RATIO_MILLS_BY_PX, TEMPO } from "../../Env";
import Track from "../../Models/Track/Track";

import "./MuseMate.css";

@DAWIYPlugin
export default class MuseMatePlugin extends DawiyPluginBase {
    id = "muse-mate-plugin";
    name = "Muse Mate (みゅーず・めいと！)";
    description = "AI Music Companion and Gamification";
    author = "Antigravity";
    version = "1.0.0";

    // We want this plugin to show up as a UI component.
    override categories: ('generator' | 'modifier' | 'analysis' | 'io' | 'ui')[] = ['ui'];

    private chatEngine!: ChatEngine;
    private gameLogic!: GameLogic;
    private characterUI!: CharacterUI;

    private directExecMode: "developer" | "auto" = "developer";
    private createdPluginsInSession: Set<string> = new Set();

    private chatMessagesArea!: HTMLDivElement;
    private affectionDisplay!: HTMLSpanElement;
    private timerDisplay!: HTMLSpanElement;

    // Settings state
    private settingsOpen = false;
    private currentMode: 'assistant' | 'composer' = 'assistant';
    private currentEmotion: string = 'default';

    constructor(app: App) {
        super(app);
    }

    public override onInit(host: HostAPI) {
        // Load settings from localStorage
        this.directExecMode = (localStorage.getItem("musemate_direct_exec_mode") as any) || "developer";

        // Initialize logic
        this.gameLogic = new GameLogic(() => this.updateUI());

        this.chatEngine = new ChatEngine(
            (msg, isUser) => this.addChatMessage(msg, isUser),
            () => this.characterUI.setTalking(true),
            () => this.characterUI.setTalking(false),
            (err) => host.ui.showToast(err, true),
            (isThinking) => {
                this.characterUI.setThinking(isThinking);
                if (isThinking) {
                    this.addThinkingMessage();
                } else {
                    this.removeThinkingMessage();
                }
            },
            (emotion) => {
                this.currentEmotion = emotion;
                this.characterUI.setEmotion(emotion);
            }
        );

        this.characterUI = new CharacterUI();

        // Hook into DAW global events if possible.
        // We can override some app methods or just use an interval to check track lengths/regions.
        // For a more robust solution, we'd hook into HostAPI events if they exist.
        // Since DAWIY doesn't have a pub/sub event system exposed on HostAPI yet, 
        // we can poll or hook into `app.doIt` indirectly, but for now we'll do simple checks.

        // Hook app.doIt to track parameter changes and user actions
        const originalDoIt = this.app.doIt.bind(this.app);
        this.app.doIt = (isUndoable, redo, undo) => {
            this.gameLogic.recordParameterChange();
            originalDoIt(isUndoable, redo, undo);
        };

        // Polling for region changes and stats
        setInterval(() => {
            if (!this.app || !this.app.tracksController) return;
            let currentRegionCount = 0;
            let currentMidiNotes = 0;
            let currentAudioRegions = 0;

            this.app.tracksController.tracks.forEach(track => {
                currentRegionCount += track.regions.length;
                track.regions.forEach(region => {
                    // Check region type and count items
                    if ((region as any).midi) {
                        currentMidiNotes += (region as any).midi.notes.length;
                    } else if ((region as any).audioBuffer || (region as any).audioUrl) {
                        currentAudioRegions++;
                    } else if ((region as any).type === 'audio') {
                        currentAudioRegions++;
                    }
                });
            });

            this.gameLogic.recordMidiCount(currentMidiNotes);
            this.gameLogic.recordAudioRegionCount(currentAudioRegions);

            // If regions increased, add affection
            if (this.lastRegionCount !== -1 && currentRegionCount > this.lastRegionCount) {
                const diff = currentRegionCount - this.lastRegionCount;
                for (let i = 0; i < diff; i++) {
                    this.gameLogic.recordRegionAdded();
                }
            }
            this.lastRegionCount = currentRegionCount;
        }, 5000);

        // --- Build UI ---
        // Instead of registerSidebarItem, we create a relative sidebar to shift the layout
        const browserDiv = document.createElement("div");
        browserDiv.id = "muse-mate-browser";
        browserDiv.style.display = "none";
        browserDiv.style.position = "relative";
        browserDiv.style.width = "350px";
        browserDiv.style.height = "100%";
        browserDiv.style.flexDirection = "column";
        browserDiv.style.borderLeft = "1px solid var(--bs-border-color)";
        browserDiv.style.backgroundColor = "var(--bs-body-bg)";
        browserDiv.style.zIndex = "50";

        const root = document.createElement("div");
        root.className = "muse-mate-container";
        root.style.width = "100%";
        root.style.height = "100%";

        // --- Character Area ---
        const charArea = document.createElement("div");
        charArea.className = "mm-character-area";
        this.characterUI.attachTo(charArea);

        // Status / Header Area
        const headerArea = document.createElement("div");
        headerArea.className = "mm-header-area";

        this.affectionDisplay = document.createElement("div");
        this.affectionDisplay.className = "mm-affection-display";
        this.affectionDisplay.innerText = "💖 好感度： 0";
        headerArea.appendChild(this.affectionDisplay);

        // Mode Switch
        const modeSwitchContainer = document.createElement("div");
        modeSwitchContainer.className = "mm-mode-switch mt-2 d-flex justify-content-center gap-2";
        
        const modeAssistantBtn = document.createElement("button");
        modeAssistantBtn.className = "btn btn-sm btn-primary";
        modeAssistantBtn.innerText = "にちよと作曲！";
        
        const modeComposerBtn = document.createElement("button");
        modeComposerBtn.className = "btn btn-sm btn-outline-primary";
        modeComposerBtn.innerText = "にちよで作曲！";
        
        modeSwitchContainer.appendChild(modeAssistantBtn);
        modeSwitchContainer.appendChild(modeComposerBtn);
        headerArea.appendChild(modeSwitchContainer);
        
        // Composer Settings (Key & Scale)
        const composerSettings = document.createElement("div");
        composerSettings.className = "mm-composer-settings mt-2 d-flex justify-content-center gap-2";
        composerSettings.style.display = "none";
        
        const keySelect = document.createElement("select");
        keySelect.id = "mm-key-select";
        keySelect.className = "form-select form-select-sm w-auto";
        keySelect.style.backgroundColor = "var(--bs-body-bg)";
        keySelect.style.color = "var(--bs-body-color)";
        const keys = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
        keys.forEach((k, i) => {
            const opt = document.createElement("option");
            opt.value = (i + 60).toString(); // MIDI Root Note (C4 = 60)
            opt.innerText = k;
            keySelect.appendChild(opt);
        });
        
        const scaleSelect = document.createElement("select");
        scaleSelect.id = "mm-scale-select";
        scaleSelect.className = "form-select form-select-sm w-auto";
        scaleSelect.style.backgroundColor = "var(--bs-body-bg)";
        scaleSelect.style.color = "var(--bs-body-color)";
        const scales = [
            { id: "major", name: "Major" },
            { id: "minor", name: "Minor" },
            { id: "pentatonic_major", name: "Major Pentatonic" },
            { id: "pentatonic_minor", name: "Minor Pentatonic" },
            { id: "chromatic", name: "Chromatic" }
        ];
        scales.forEach(s => {
            const opt = document.createElement("option");
            opt.value = s.id;
            opt.innerText = s.name;
            scaleSelect.appendChild(opt);
        });
        
        composerSettings.appendChild(keySelect);
        // composerSettings.appendChild(scaleSelect);
        headerArea.appendChild(composerSettings);

        modeAssistantBtn.onclick = () => {
            this.currentMode = 'assistant';
            modeAssistantBtn.className = "btn btn-sm btn-primary";
            modeComposerBtn.className = "btn btn-sm btn-outline-primary";
            composerSettings.style.display = "none";
        };
        
        modeComposerBtn.onclick = () => {
            this.currentMode = 'composer';
            modeComposerBtn.className = "btn btn-sm btn-primary";
            modeAssistantBtn.className = "btn btn-sm btn-outline-primary";
            composerSettings.style.display = "flex";
        };

        root.appendChild(headerArea);

        // --- Status Bar ---
        const statusBar = document.createElement("div");
        statusBar.className = "mm-status-bar";

        this.timerDisplay = document.createElement("span");
        this.timerDisplay.className = "mm-timer";

        statusBar.appendChild(this.timerDisplay);

        // --- Chat Area ---
        this.chatMessagesArea = document.createElement("div");
        this.chatMessagesArea.className = "mm-chat-area";

        // --- Input Area ---
        const inputArea = document.createElement("div");
        inputArea.className = "mm-input-area";

        const inputRow = document.createElement("div");
        inputRow.className = "mm-input-row";

        const textInput = document.createElement("textarea");
        textInput.placeholder = "にちよと話す...";
        textInput.rows = 1;

        textInput.addEventListener("input", () => {
            textInput.style.height = "auto";
            textInput.style.height = (textInput.scrollHeight + 2) + "px";
        });

        const sendBtn = document.createElement("button");
        sendBtn.innerHTML = '<i class="bi bi-send"></i>';

        const voiceBtn = document.createElement("button");
        voiceBtn.innerHTML = '<i class="bi bi-mic"></i>';
        let isRecording = false;

        this.chatEngine.onRecordingEnded = () => {
            isRecording = false;
            voiceBtn.classList.remove("recording");
        };

        textInput.addEventListener("keydown", (e) => {
            if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                const val = textInput.value.trim();
                if (val) {
                    this.chatEngine.sendMessage(val);
                    this.gameLogic.recordChat();
                }
                textInput.value = "";
                textInput.style.height = "auto";
            }
        });

        sendBtn.addEventListener("click", () => {
            const val = textInput.value.trim();
            if (val) {
                this.chatEngine.sendMessage(val);
                this.gameLogic.recordChat();
            }
            textInput.value = "";
            textInput.style.height = "auto";
        });

        voiceBtn.addEventListener("click", () => {
            if (isRecording) {
                this.chatEngine.stopRecording();
                voiceBtn.classList.remove("recording");
                isRecording = false;
            } else {
                this.chatEngine.startRecording();
                voiceBtn.classList.add("recording");
                isRecording = true;
            }
        });

        // Pomodoro / Settings Controls
        const controlRow = document.createElement("div");
        controlRow.style.display = "flex";
        controlRow.style.gap = "5px";
        controlRow.style.marginTop = "5px";

        const pomoBtn = document.createElement("button");
        pomoBtn.className = "btn btn-sm btn-outline-primary";
        pomoBtn.innerText = "25分 ポモドーロタイマー";
        pomoBtn.onclick = () => {
            if (this.gameLogic.isTimerRunning) this.gameLogic.stopPomodoro();
            else this.gameLogic.startPomodoro(25);
        };

        const settingsBtn = document.createElement("button");
        settingsBtn.className = "btn btn-sm btn-outline-secondary";
        settingsBtn.innerHTML = '<i class="bi bi-gear"></i>';

        controlRow.appendChild(pomoBtn);
        controlRow.appendChild(settingsBtn);

        inputRow.appendChild(textInput);
        inputRow.appendChild(voiceBtn);
        inputRow.appendChild(sendBtn);

        inputArea.appendChild(inputRow);
        inputArea.appendChild(controlRow);

        // --- Settings Area ---
        const settingsArea = this.createSettingsArea();
        settingsBtn.onclick = () => {
            this.settingsOpen = !this.settingsOpen;
            settingsArea.classList.toggle("show", this.settingsOpen);
        };


        // --- Resizer Handle ---
        const resizer = document.createElement("div");
        resizer.className = "mm-resizer";
        resizer.style.width = "5px";
        resizer.style.cursor = "col-resize";
        resizer.style.position = "absolute";
        resizer.style.left = "0";
        resizer.style.top = "0";
        resizer.style.bottom = "0";
        resizer.style.zIndex = "10";
        resizer.style.backgroundColor = "transparent";

        let isResizing = false;
        let lastX = 0;

        resizer.addEventListener("mousedown", (e) => {
            isResizing = true;
            lastX = e.clientX;
            document.body.style.cursor = "col-resize";
        });

        document.addEventListener("mousemove", (e) => {
            if (!isResizing) return;
            const dx = lastX - e.clientX;
            lastX = e.clientX;
            let newWidth = browserDiv.offsetWidth + dx;
            if (newWidth < 250) newWidth = 250;
            if (newWidth > 800) newWidth = 800;
            browserDiv.style.width = newWidth + "px";
        });

        document.addEventListener("mouseup", () => {
            if (isResizing) {
                isResizing = false;
                document.body.style.cursor = "";
            }
        });

        // Append all to root
        root.appendChild(resizer);
        root.appendChild(charArea);
        root.appendChild(statusBar);
        root.appendChild(this.chatMessagesArea);
        root.appendChild(inputArea);
        root.appendChild(settingsArea);

        browserDiv.appendChild(root);

        // Insert into DOM next to other sidebars
        const toggleButtons = document.getElementById("ToggleButtons");
        if (toggleButtons && toggleButtons.parentNode) {
            toggleButtons.parentNode.insertBefore(browserDiv, toggleButtons);

            // Add toggle button
            const btn = document.createElement("button");
            btn.id = "mm-toggle-btn";
            btn.innerHTML = '<i class="bi bi-person-heart"></i>';
            btn.title = "みゅーず・めいと";

            btn.addEventListener("click", () => {
                const isVisible = browserDiv.style.display !== "none";
                if (isVisible) {
                    browserDiv.style.display = "none";
                    btn.classList.remove("active");
                } else {
                    browserDiv.style.display = "flex";
                    btn.classList.add("active");
                }
            });

            toggleButtons.appendChild(btn);
        }

        this.updateUI();
    }

    private lastRegionCount: number = -1;

    public override getUserData() {
        return {
            ...this.gameLogic.getSaveData(),
            provider: (this.chatEngine as any).provider,
            apiKeyOpenAI: (this.chatEngine as any).apiKeyOpenAI,
            apiKeyGemini: (this.chatEngine as any).apiKeyGemini,
            coeiroinkUrl: (this.chatEngine as any).coeiroinkUrl,
            modelGemini: (this.chatEngine as any).modelGemini,
            modelOpenAI: (this.chatEngine as any).modelOpenAI
        };
    }

    public override setUserData(data: any) {
        this.gameLogic.loadSaveData(data);
        if (data) {
            this.chatEngine.setSettings(
                data.provider || "gemini",
                data.apiKeyOpenAI || "",
                data.apiKeyGemini || "",
                data.coeiroinkUrl || "",
                data.modelGemini || "gemini-2.5-flash",
                data.modelOpenAI || "gpt-4o"
            );
        }
    }

    private dashUpdateInterval: any = null;

    public override render(container: HTMLElement) {
        container.innerHTML = `
            <div class="mm-dashboard">
                <div class="mm-dashboard-header">
                    <h4>Muse Mate アクティビティ</h4>
                    <div style="font-size: 0.9em;">
                        <label>AIモデル制限: </label>
                        <select id="mm-dash-model-select" class="form-select form-select-sm d-inline-block" style="width: 200px; background-color: var(--bs-body-bg); color: var(--bs-body-color);">
                            <option value="20">Gemini 2.5 Flash</option>
                            <option value="20">Gemini 2.5 Flash Lite</option>
                            <option value="20">Gemini 3 Flash</option>
                            <option value="500">Gemini 3.1 Flash Lite</option>
                            <option value="20">Gemini 3.5 Flash</option>
                            <option value="500">Gemini 3.5 Flash Lite</option>
                            <option value="20">Gemini 3.6 Flash</option>
                            <option value="20">Gemini 3.7 Flash</option>
                        </select>
                    </div>
                </div>
                
                <div class="mm-dashboard-grid">
                    <div class="mm-dash-card">
                        <div class="mm-dash-title">本日の配置MIDI数</div>
                        <div class="mm-dash-value" id="mm-dash-midi">0</div>
                    </div>
                    <div class="mm-dash-card">
                        <div class="mm-dash-title">本日の配置オーディオ数</div>
                        <div class="mm-dash-value" id="mm-dash-audio">0</div>
                    </div>
                    <div class="mm-dash-card">
                        <div class="mm-dash-title">本日の作業時間</div>
                        <div class="mm-dash-value" id="mm-dash-time">0m 0s</div>
                    </div>
                    <div class="mm-dash-card">
                        <div class="mm-dash-title">パラメータ操作回数</div>
                        <div class="mm-dash-value" id="mm-dash-params">0</div>
                    </div>
                    <div class="mm-dash-card">
                        <div class="mm-dash-title">本日の会話回数</div>
                        <div class="mm-dash-value" id="mm-dash-chats">0</div>
                    </div>
                    <div class="mm-dash-card" style="border: 1px solid var(--bs-primary);">
                        <div class="mm-dash-title text-primary">残り会話可能回数 (目安)</div>
                        <div class="mm-dash-value text-primary" id="mm-dash-chats-remaining">0</div>
                    </div>
                </div>

                <div class="mm-dash-graph-container mt-3">
                    <h6 class="mb-2">好感度の推移</h6>
                    <svg id="mm-dash-affection-graph" viewBox="0 0 500 150" preserveAspectRatio="none" style="width: 100%; height: 150px; background: rgba(0,0,0,0.1); border-radius: 5px;"></svg>
                </div>
            </div>
        `;

        const updateDashboard = () => {
            if (!document.getElementById("mm-dash-midi")) return; // Not in DOM
            
            const stats = this.gameLogic.getTodayStats();
            
            const midiEl = document.getElementById("mm-dash-midi");
            if (midiEl) midiEl.innerText = stats.midiNotes.toString();
            
            const audioEl = document.getElementById("mm-dash-audio");
            if (audioEl) audioEl.innerText = stats.audioRegions.toString();
            
            const timeEl = document.getElementById("mm-dash-time");
            if (timeEl) {
                const h = Math.floor(stats.sessionTimeSeconds / 3600);
                const m = Math.floor((stats.sessionTimeSeconds % 3600) / 60);
                const s = stats.sessionTimeSeconds % 60;
                timeEl.innerText = h > 0 ? `${h}時間 ${m}分 ${s}秒` : `${m}分 ${s}秒`;
            }
            
            const paramsEl = document.getElementById("mm-dash-params");
            if (paramsEl) paramsEl.innerText = stats.parametersChanged.toString();
            
            const chatsEl = document.getElementById("mm-dash-chats");
            if (chatsEl) chatsEl.innerText = stats.chats.toString();
            
            const selectEl = document.getElementById("mm-dash-model-select") as HTMLSelectElement;
            const remainingEl = document.getElementById("mm-dash-chats-remaining");
            if (selectEl && remainingEl) {
                const limit = parseInt(selectEl.value) || 20;
                const remaining = Math.max(0, limit - stats.chats);
                remainingEl.innerText = remaining.toString();
            }

            // Draw SVG Graph
            const svg = document.getElementById("mm-dash-affection-graph");
            if (svg) {
                const history = this.gameLogic.affectionHistory;
                if (history.length > 1) {
                    const minScore = Math.min(...history.map(h => h.score));
                    const maxScore = Math.max(...history.map(h => h.score), minScore + 10);
                    
                    const width = 500;
                    const height = 150;
                    const padding = 10;
                    
                    let pathD = "";
                    history.forEach((entry, i) => {
                        const x = padding + (i / (history.length - 1)) * (width - padding * 2);
                        const normalizedY = (entry.score - minScore) / (maxScore - minScore);
                        const y = height - padding - (normalizedY * (height - padding * 2));
                        
                        if (i === 0) pathD += `M ${x} ${y} `;
                        else pathD += `L ${x} ${y} `;
                    });
                    
                    svg.innerHTML = `
                        <path d="${pathD}" fill="none" stroke="#ff69b4" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
                        <text x="5" y="15" fill="#ff69b4" font-size="12">最高: ${maxScore}</text>
                        <text x="5" y="145" fill="#ff69b4" font-size="12">最低: ${minScore}</text>
                    `;
                } else {
                    svg.innerHTML = '<text x="200" y="80" fill="gray" font-size="14">データが不足しています。</text>';
                }
            }
        };

        // Initial update
        updateDashboard();

        // Update when select changes
        const selectEl = document.getElementById("mm-dash-model-select");
        if (selectEl) {
            selectEl.addEventListener("change", updateDashboard);
        }

        if (this.dashUpdateInterval) clearInterval(this.dashUpdateInterval);
        this.dashUpdateInterval = setInterval(updateDashboard, 1000);
    }

    public override onDeactivate() {
        this.characterUI.detach();
        if (this.dashUpdateInterval) {
            clearInterval(this.dashUpdateInterval);
        }
    }

    private async generateMelodyFromText(text: string) {
        // Remove tags and clean text
        const cleanText = text.replace(/\[.*?\]/g, "").replace(/\n/g, "").trim();
        if (cleanText.length === 0) return;

        // Determine key
        const keySelect = document.getElementById("mm-key-select") as HTMLSelectElement;
        const baseNote = parseInt(keySelect?.value || "60");

        const emotion = this.currentEmotion;

        // Define scale intervals based on emotion
        let intervals = [0, 2, 4, 5, 7, 9, 11]; // Major (default/joy)
        if (emotion === 'sad') intervals = [0, 2, 3, 5, 7, 8, 10]; // Minor
        else if (emotion === 'angry') intervals = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]; // Chromatic

        // Generate scale pool (2 octaves down, 2 octaves up)
        const scalePool: number[] = [];
        for (let oct = -2; oct <= 2; oct++) {
            intervals.forEach(i => scalePool.push(baseNote + oct * 12 + i));
        }

        let baseVelocity = 100;
        let pitchIndexOffset = Math.floor(scalePool.length / 2); // Center
        let beatDivision = 4; // default quarter notes

        if (emotion === 'joy') {
            pitchIndexOffset += intervals.length; // +1 octave
            beatDivision = 8; // faster
        } else if (emotion === 'sad') {
            pitchIndexOffset -= intervals.length; // -1 octave
            beatDivision = 2; // slower
            baseVelocity = 70;
        } else if (emotion === 'angry') {
            baseVelocity = 127;
            beatDivision = 16; // very fast
        } else if (emotion === 'pout') {
            beatDivision = 8;
        }

        const beatMs = (60 / TEMPO) * 1000;
        const notesToAdd: { pitch: number, start: number, duration: number, velocity: number }[] = [];
        let currentMs = 0;
        
        let pitchIndex = pitchIndexOffset;
        let poutRepeatCount = 0;
        let poutCurrentPitch = scalePool[pitchIndex];

        // For smooth sine-like movement
        let phase = 0;

        for (let i = 0; i < cleanText.length; i++) {
            const char = cleanText[i];
            
            // Duration logic
            let durRatio = 1 / (beatDivision / 4); // 4->1, 8->0.5, 2->2
            if (/[\u4E00-\u9FAF]/.test(char)) {
                durRatio *= 2; // Kanji is longer
            }
            
            const noteDurMs = beatMs * durRatio;
            
            // Pitch logic
            if (emotion === 'joy' || emotion === 'sad' || emotion === 'default') {
                // Smooth continuous up/down
                phase += 0.5 + Math.random() * 0.5; // advance phase
                // Use sine wave to smoothly oscillate around the offset
                const offset = Math.floor(Math.sin(phase) * (intervals.length)); 
                pitchIndex = pitchIndexOffset + offset;
            } else if (emotion === 'angry') {
                // Jumpy
                pitchIndex = pitchIndexOffset + Math.floor(Math.random() * 20) - 10;
            } else if (emotion === 'pout') {
                if (poutRepeatCount <= 0) {
                    // pick a new note
                    pitchIndex = pitchIndexOffset + Math.floor(Math.random() * intervals.length) - Math.floor(intervals.length / 2);
                    pitchIndex = Math.max(0, Math.min(scalePool.length - 1, pitchIndex));
                    poutCurrentPitch = scalePool[pitchIndex];
                    poutRepeatCount = Math.floor(Math.random() * 5); // 0 to 4 more repeats (1 to 5 total)
                } else {
                    poutRepeatCount--;
                }
            }
            
            // Clamp pitch index
            pitchIndex = Math.max(0, Math.min(scalePool.length - 1, pitchIndex));
            
            const pitch = (emotion === 'pout') ? poutCurrentPitch : scalePool[pitchIndex];
            
            // For pout, make it staccato
            let actualDur = noteDurMs;
            if (emotion === 'pout') actualDur *= 0.5;

            notesToAdd.push({
                pitch: pitch,
                start: currentMs,
                duration: actualDur,
                velocity: baseVelocity + (Math.random() * 10 - 5)
            });
            
            currentMs += noteDurMs;
        }

        // Add to project
        try {
            // Get selected track or create new
            let targetTrack = this.app.tracksController.selectedTrack;
            if (!targetTrack) {
                targetTrack = await this.app.tracksController.createTrack();
                if (targetTrack) targetTrack.element.name = "Nichiyo Composer";
            }
            
            const startMs = this.app.host.playhead;
            const midi = new MIDI(500, currentMs);
            
            notesToAdd.forEach(n => {
                midi.putNote(new MIDINote(n.pitch, n.velocity, 0, n.duration), n.start);
            });
            
            const newRegion = new MIDIRegion(midi, startMs);
            if (targetTrack) {
                this.app.regionsController.addRegion(targetTrack, newRegion);
                this.app.hostAPI.ui.showToast(`にちよのメロディ (${notesToAdd.length}音) を追加しました！`);
            }
            
        } catch (e: any) {
            console.error("Composer Mode Error:", e);
        }
    }

    private createSettingsArea(): HTMLDivElement {
        const area = document.createElement("div");
        area.className = "mm-settings-area";

        area.innerHTML = `
            <h5>設定</h5>
            <div>
                <label>プロバイダー</label>
                <select id="mm-provider" class="form-select form-select-sm">
                    <option value="gemini">Gemini</option>
                    <option value="openai">OpenAI</option>
                </select>
            </div>
            <div>
                <label>モデル</label>
                <div class="d-flex gap-1">
                    <select id="mm-model" class="form-select form-select-sm"></select>
                    <button id="mm-refresh-models" class="btn btn-sm btn-outline-secondary" title="Load Available Models"><i class="bi bi-arrow-clockwise"></i></button>
                </div>
            </div>
            <div>
                <label>Gemini API Key</label>
                <input type="password" id="mm-gemini-key" class="form-control form-control-sm" />
            </div>
            <div>
                <label>OpenAI API Key</label>
                <input type="password" id="mm-openai-key" class="form-control form-control-sm" />
            </div>
            <div>
                <label>COEIROINKのURL</label>
                <input type="text" id="mm-coeiroink" class="form-control form-control-sm" value="http://127.0.0.1:50032" />
            </div>
            <div>
                <label>即時操作モード</label>
                <select id="mm-exec-mode" class="form-select form-select-sm">
                    <option value="developer">確認あり (コード表示)</option>
                    <option value="auto">確認なし (自動実行)</option>
                </select>
            </div>
            <button id="mm-save-settings" class="btn btn-sm btn-primary mt-2">保存して閉じる</button>
        `;

        setTimeout(() => {
            const provider = document.getElementById("mm-provider") as HTMLSelectElement;
            const model = document.getElementById("mm-model") as HTMLSelectElement;
            const refreshModels = document.getElementById("mm-refresh-models") as HTMLButtonElement;
            const geminiKey = document.getElementById("mm-gemini-key") as HTMLInputElement;
            const openaiKey = document.getElementById("mm-openai-key") as HTMLInputElement;
            const coeiroink = document.getElementById("mm-coeiroink") as HTMLInputElement;
            const execMode = document.getElementById("mm-exec-mode") as HTMLSelectElement;
            const saveBtn = document.getElementById("mm-save-settings") as HTMLButtonElement;

            // Set initial values
            const engine = this.chatEngine as any;
            provider.value = engine.provider || "gemini";
            geminiKey.value = engine.apiKeyGemini || "";
            openaiKey.value = engine.apiKeyOpenAI || "";
            coeiroink.value = engine.coeiroinkUrl || "http://127.0.0.1:50032";
            execMode.value = this.directExecMode;

            execMode.onchange = () => {
                this.directExecMode = execMode.value as any;
                localStorage.setItem("musemate_direct_exec_mode", this.directExecMode);
            };

            let selectedGeminiModel = engine.modelGemini || "gemini-2.5-flash";
            let selectedOpenAIModel = engine.modelOpenAI || "gpt-4o";

            const populateModels = async () => {
                refreshModels.innerHTML = '<i class="bi bi-hourglass"></i>';
                refreshModels.disabled = true;
                model.innerHTML = '';

                const currentProv = provider.value as "openai" | "gemini";
                const key = currentProv === "gemini" ? geminiKey.value : openaiKey.value;

                if (!key) {
                    const opt = document.createElement("option");
                    opt.value = "";
                    opt.innerText = "APIキーを入力してください";
                    model.appendChild(opt);
                } else {
                    const models = await engine.getAvailableModels(currentProv, key);
                    if (models.length === 0) {
                        const opt = document.createElement("option");
                        opt.value = "";
                        opt.innerText = "取得失敗・モデルなし";
                        model.appendChild(opt);
                    } else {
                        models.forEach((m: any) => {
                            const opt = document.createElement("option");
                            opt.value = m.id;
                            opt.innerText = m.name;
                            model.appendChild(opt);
                        });
                        model.value = currentProv === "gemini" ? selectedGeminiModel : selectedOpenAIModel;
                        if (!model.value) model.value = models[0].id;
                    }
                }
                refreshModels.innerHTML = '<i class="bi bi-arrow-clockwise"></i>';
                refreshModels.disabled = false;
            };

            provider.addEventListener("change", populateModels);
            refreshModels.addEventListener("click", populateModels);
            geminiKey.addEventListener("change", populateModels);
            openaiKey.addEventListener("change", populateModels);

            // Initial load
            populateModels();

            saveBtn.onclick = () => {
                const currentProv = provider.value as "openai" | "gemini";
                if (currentProv === "gemini") selectedGeminiModel = model.value;
                else selectedOpenAIModel = model.value;

                this.chatEngine.setSettings(
                    currentProv,
                    openaiKey.value,
                    geminiKey.value,
                    coeiroink.value,
                    selectedGeminiModel,
                    selectedOpenAIModel
                );
                this.settingsOpen = false;
                area.classList.remove("show");
            };
        }, 0);

        return area;
    }

    private addChatMessage(message: string, isUser: boolean) {
        const msgDiv = document.createElement("div");
        msgDiv.className = `mm-chat-message ${isUser ? 'user' : 'bot'}`;

        if (isUser || message.startsWith("[SYSTEM]")) {
            msgDiv.innerText = message;
        } else {
            // Parse code blocks for bot messages
            const codeBlockRegex = /```(typescript-exec|javascript-exec|typescript|javascript)([\s\S]*?)```/g;
            let lastIndex = 0;
            let match;
            let foundCode = false;

            while ((match = codeBlockRegex.exec(message)) !== null) {
                foundCode = true;
                const lang = match[1];
                const code = match[2].trim();

                const before = message.substring(lastIndex, match.index);
                if (before.trim()) {
                    const p = document.createElement("div");
                    p.innerHTML = this.parseMarkdown(before.trim());
                    msgDiv.appendChild(p);
                }

                if (lang === "typescript-exec" || lang === "javascript-exec") {
                    if (this.directExecMode === "auto") {
                        this.executeDirectly(code);
                    } else {
                        const pre = document.createElement("pre");
                        pre.innerText = code;
                        pre.style.background = "#212529";
                        pre.style.color = "#ffffff";
                        pre.style.padding = "10px";
                        pre.style.borderRadius = "5px";
                        pre.style.overflowX = "auto";
                        msgDiv.appendChild(pre);

                        const execBtn = document.createElement("button");
                        execBtn.innerText = "▶ 今すぐ実行 (Execute Now)";
                        execBtn.style.marginTop = "5px";
                        execBtn.style.padding = "5px 10px";
                        execBtn.style.background = "#ffc107";
                        execBtn.style.border = "none";
                        execBtn.style.borderRadius = "3px";
                        execBtn.style.cursor = "pointer";
                        execBtn.onclick = () => this.executeDirectly(code);
                        msgDiv.appendChild(execBtn);
                    }
                } else if (lang === "typescript" || lang === "javascript") {
                    const pre = document.createElement("pre");
                    pre.innerText = code;
                    pre.style.background = "#212529";
                    pre.style.color = "#ffffff";
                    pre.style.padding = "10px";
                    pre.style.borderRadius = "5px";
                    pre.style.overflowX = "auto";
                    msgDiv.appendChild(pre);

                    const btn = document.createElement("button");
                    const classNameMatch = code.match(/class\s+(\w+)/);
                    const className = classNameMatch ? classNameMatch[1] : "GeneratedPlugin";

                    const codeHash = className + "_" + this.hashCode(code);
                    if (this.createdPluginsInSession.has(codeHash)) {
                        btn.disabled = true;
                        btn.innerText = "✔️ 作成済み";
                        btn.style.background = "#28a745";
                    } else {
                        btn.innerText = "🔧 プラグインを作成";
                        btn.onclick = async () => {
                            const success = await this.createPlugin(className, code);
                            if (success) {
                                btn.disabled = true;
                                btn.innerText = "✔️ 作成済み";
                                btn.style.background = "#28a745";
                                btn.style.cursor = "default";
                                this.createdPluginsInSession.add(codeHash);
                            }
                        };
                    }
                    btn.style.marginTop = "5px";
                    btn.style.padding = "5px 10px";
                    btn.style.border = "none";
                    btn.style.borderRadius = "3px";
                    btn.style.cursor = "pointer";
                    if (!btn.disabled) btn.style.background = "#0d6efd";
                    btn.style.color = "white";
                    msgDiv.appendChild(btn);
                }

                lastIndex = match.index + match[0].length;
            }

            const remaining = message.substring(lastIndex);
            if (remaining.trim()) {
                const p = document.createElement("div");
                p.innerHTML = this.parseMarkdown(remaining.trim());
                msgDiv.appendChild(p);
            }

            if (!foundCode) {
                msgDiv.innerHTML = this.parseMarkdown(message);
            }
        }

        this.chatMessagesArea.appendChild(msgDiv);
        this.chatMessagesArea.scrollTop = this.chatMessagesArea.scrollHeight;

        if (!isUser && this.currentMode === 'composer') {
            this.generateMelodyFromText(message);
        }
    }

    private parseMarkdown(text: string): string {
        let html = text
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;");

        // Bold
        html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
        html = html.replace(/__(.+?)__/g, "<strong>$1</strong>");

        // Italic
        html = html.replace(/\*(.+?)\*/g, "<em>$1</em>");

        // Code
        html = html.replace(/`([^`]+)`/g, "<code>$1</code>");

        // Line breaks
        html = html.replace(/\n/g, '<br>');

        return html;
    }

    private hashCode(str: string): number {
        let hash = 0;
        for (let i = 0, len = str.length; i < len; i++) {
            let chr = str.charCodeAt(i);
            hash = (hash << 5) - hash + chr;
            hash |= 0;
        }
        return hash;
    }

    private async createPlugin(className: string, code: string): Promise<boolean> {
        const filename = `${className}/${className}.ts`;
        const confirmed = window.confirm(`プラグイン ${filename} を生成し、ホットリロードを実行しますか？`);
        if (!confirmed) return false;

        try {
            const response = await fetch('/upload-plugin', {
                method: 'POST',
                headers: {
                    'Content-Type': 'text/plain',
                    'x-filename': filename
                },
                body: code
            });

            if (response.ok) {
                // (removed system message for successful save)
                return true;
            } else {
                const text = await response.text();
                this.addChatMessage(`[SYSTEM] プラグインの保存に失敗しました: ` + text, false);
                return false;
            }
        } catch (e: any) {
            this.addChatMessage(`[SYSTEM] エラー: ` + e.message, false);
            return false;
        }
    }

    private async executeDirectly(code: string) {
        console.log("%c[MuseMate] Executing Direct Code:", "color: #ff69b4; font-weight: bold; background: #212529; padding: 2px 5px; border-radius: 3px;");
        console.log(code);

        try {
            // @ts-ignore
            const app = (window as any).app;
            const hostAPI = app.hostAPI;

            const AsyncFunction = Object.getPrototypeOf(async function () { }).constructor;
            const fn = new AsyncFunction('app', 'hostAPI', code);
            await fn(app, hostAPI);

        } catch (e: any) {
            this.addChatMessage("[SYSTEM] 直接操作の実行に失敗しました: " + e.message, false);
            console.error("Direct Execution Error:", e);
        }
    }

    private thinkingMsgDiv: HTMLDivElement | null = null;

    private addThinkingMessage() {
        if (this.thinkingMsgDiv) return;
        this.thinkingMsgDiv = document.createElement("div");
        this.thinkingMsgDiv.className = `mm-chat-message bot`;
        this.thinkingMsgDiv.innerHTML = `にちよが考え中<span class="mm-loading-dots"></span>`;
        this.chatMessagesArea.appendChild(this.thinkingMsgDiv);
        this.chatMessagesArea.scrollTop = this.chatMessagesArea.scrollHeight;
    }

    private removeThinkingMessage() {
        if (this.thinkingMsgDiv && this.thinkingMsgDiv.parentElement) {
            this.thinkingMsgDiv.parentElement.removeChild(this.thinkingMsgDiv);
            this.thinkingMsgDiv = null;
        }
    }

    private updateUI() {
        if (this.affectionDisplay) {
            this.affectionDisplay.innerText = `♡ 好感度： ${this.gameLogic.getAffectionScore()}`;
        }
        if (this.timerDisplay) {
            if (this.gameLogic.isTimerRunning) {
                this.timerDisplay.innerText = `⏱️ ${this.gameLogic.getFormattedTimer()}`;
            } else {
                this.timerDisplay.innerText = "";
            }
        }
    }
}
