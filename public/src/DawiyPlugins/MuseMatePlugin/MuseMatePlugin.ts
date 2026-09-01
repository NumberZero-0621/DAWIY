import { DAWIYPlugin } from "../IDawiyPlugin";
import DawiyPluginBase from "../DawiyPluginBase";
import App from "../../App";
import HostAPI from "../API/HostAPI";

import { GameLogic } from "./GameLogic";
import { ChatEngine } from "./ChatEngine";
import { CharacterUI } from "./CharacterUI";

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
            (emotion) => this.characterUI.setEmotion(emotion)
        );

        this.characterUI = new CharacterUI();

        // Hook into DAW global events if possible.
        // We can override some app methods or just use an interval to check track lengths/regions.
        // For a more robust solution, we'd hook into HostAPI events if they exist.
        // Since DAWIY doesn't have a pub/sub event system exposed on HostAPI yet, 
        // we can poll or hook into `app.doIt` indirectly, but for now we'll do simple checks.

        // Simple polling for region changes as a workaround
        setInterval(() => {
            if (!this.app || !this.app.tracksController) return;
            let currentRegionCount = 0;
            this.app.tracksController.tracks.forEach(track => {
                currentRegionCount += track.regions.length;
            });

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

        const textInput = document.createElement("input");
        textInput.type = "text";
        textInput.placeholder = "にちよと話す...";

        const sendBtn = document.createElement("button");
        sendBtn.innerHTML = '<i class="bi bi-send"></i>';

        const voiceBtn = document.createElement("button");
        voiceBtn.innerHTML = '<i class="bi bi-mic"></i>';
        let isRecording = false;

        this.chatEngine.onRecordingEnded = () => {
            isRecording = false;
            voiceBtn.classList.remove("recording");
        };

        textInput.addEventListener("keypress", (e) => {
            if (e.key === "Enter") {
                this.chatEngine.sendMessage(textInput.value);
                this.gameLogic.recordOperation();
                textInput.value = "";
            }
        });

        sendBtn.addEventListener("click", () => {
            this.chatEngine.sendMessage(textInput.value);
            this.gameLogic.recordOperation();
            textInput.value = "";
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

    public override render(container: HTMLElement) {
        container.innerHTML = `
            <div style="padding: 20px; text-align: center; color: var(--bs-secondary-color);">
                <h4>Muse Mate (みゅーず・めいと！)</h4>
                <p>画面右側のサイドバーに追加されています！<br>右側の「<i class="bi bi-person-heart"></i>」アイコンをクリックして開いてください。</p>
            </div>
        `;
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
                    p.innerText = before.trim();
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
                p.innerText = remaining.trim();
                msgDiv.appendChild(p);
            }

            if (!foundCode) {
                msgDiv.innerText = message;
            }
        }

        this.chatMessagesArea.appendChild(msgDiv);
        this.chatMessagesArea.scrollTop = this.chatMessagesArea.scrollHeight;
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

    public override onDeactivate() {
        this.characterUI.detach();
    }
}
