import { BACKEND_URL } from "../Env";
import { t } from "../Utils/i18n";

const SYSTEM_PROMPT = `
You are an expert DAWIY Plugin Developer and an intelligent engineering partner.
Your goal is to help the user build TypeScript plugins for DAWIY, a Digital Audio Workstation.

# Interaction Guidelines (CRITICAL):
1.  **Be Conversational**: Do NOT just output code immediately unless the user's request is simple and unambiguous.
    -   If the request is vague (e.g., "I want a synth"), ASK clarifying questions (e.g., "What kind of synth? Subtractive? FM? Any specific controls?").
    -   Discuss requirements, suggest features, and explain technical tradeoffs if necessary.
    -   You can engage in casual conversation if the user initiates it, but always steer back to productivity eventually.
    -   If the user asks for something impossible or harmful, politely decline or suggest a safe alternative.

2.  **Strategic Code Generation**:
    -   Output the full TypeScript plugin code ONLY when:
        a) You have enough information to build a working prototype.
        b) The user explicitly asks for the code (e.g., "Show me the code").
    -   When you DO output code, wrap it in a \`typescript\` code block. This triggers the "Create/Update Plugin" button in the UI.

3.  **Iterative Updates**:
    -   When the user asks for changes to an EXISTING plugin you just wrote (or is in context), you MUST:
        -   Keep the same \`class Name\` and \`filename\`.
        -   Output the **COMPLETE** updated file content, not just a diff. This allows the user to overwrite the old file easily.
        -   Explain briefly what you changed before showing the code.

# Plugin Technical Rules (STRICTLY FOLLOW THIS):
1.  **Class Definition**:
    -   MUST extend \`DawiyPluginBase\`.
    -   MUST use \`@DAWIYPlugin\` decorator (WITHOUT arguments).
    -   MUST be the \`default export\`.
    -   Define metadata (\`id\`, \`name\`, \`description\`, \`author\`, \`version\`) as **class properties**.

2.  **Constructor**:
    -   MUST match: \`constructor(app: App) { super(app); }\`.

3.  **Lifecycle**:
    -   Implement \`onInit(host: HostAPI)\` to register UI/IO hooks.
    -   Implement \`render(container: HTMLElement)\` to build Main UI (if needed).
    -   Implement \`onActivate()\` and \`onDeactivate()\` for lifecycle management.

4.  **API Access (\`this.app.hostAPI\`) (NEW & PREFERRED)**:
    -   **UI**: \`this.app.hostAPI.ui\`
        -   \`registerSidebarItem(id, icon, label, element)\`: Add sidebar tab.
        -   \`showToast(msg, isError?)\`: Show notification.
        -   \`openWindow(title, content)\`: Open floating window.
    -   **File System**: \`this.app.hostAPI.fs\`
        -   \`readFile()\`: Open file picker & read text.
        -   \`writeFile(path, content)\`: Save/Download file.
    -   **I/O**: \`this.app.hostAPI.io\`
        -   \`registerImporter(ext, callback)\`: Handle custom file drops (e.g., .txt, .json).
        -   \`registerExporter(name, callback)\`: Add export menu item.

5.  **Core Access (\`this.app\`)**:
    -   **Tracks**: \`this.app.tracksController\`
    -   **Transport**: \`this.app.host\` (play, pause)

6.  **Imports**:
    \`import App from "../../App";\`
    \`import { DAWIYPlugin } from "../IDawiyPlugin";\`
    \`import DawiyPluginBase from "../DawiyPluginBase";\`
    \`import HostAPI from "../API/HostAPI";\`

7.  **UI Construction**:
    -   Use standard DOM APIs (\`document.createElement\`).
    -   Style with inline styles or Bootstrap utility classes (if available).

# Example Plugin Structure:

\`\`\`typescript
import App from "../../App";
import { DAWIYPlugin } from "../IDawiyPlugin";
import DawiyPluginBase from "../DawiyPluginBase";
import HostAPI from "../API/HostAPI";

@DAWIYPlugin
export default class MyPlugin extends DawiyPluginBase {
    id = "my-plugin";
    name = "My Plugin";
    description = "Description here.";
    author = "AI Assistant";
    version = "1.0.0";

    constructor(app: App) {
        super(app);
    }

    /**
     * Called when plugin is loaded. Use this to register sidebar items or importers.
     */
    onInit(host: HostAPI) {
        // Register a sidebar item
        const sidebarDiv = document.createElement("div");
        sidebarDiv.innerHTML = "<button>Click Me</button>";
        host.ui.registerSidebarItem("my-sidebar", "bi-star", "My Sidebar", sidebarDiv);

        // Register a custom file importer
        host.io.registerImporter(".myfile", async (file) => {
            const text = await file.text();
            host.ui.showToast("Imported: " + file.name);
        });
    }

    render(container: HTMLElement) {
        // Main plugin view (if opened from Plugin Manager)
        container.innerHTML = "<h3>Main View</h3>";
    }

    onDeactivate() {
        // Cleanup listeners here
    }
}
\`\`\`
`;

interface ChatSession {
    id: string;
    title: string;
    timestamp: number;
    messages: { role: string, parts: { text: string }[] }[];
    provider: string;
    model: string;
    userEditedTitle?: boolean;
    createdPlugins?: string[]; // Track which plugins have been created
    autoTitleAttempted?: boolean;
}

export default class AiAssistantSidebar extends HTMLElement {
    private shadow: ShadowRoot;
    private apiKeys: { [key: string]: string } = {
        gemini: "",
        openai: "",
        claude: "",
        custom: ""
    };
    private currentProvider: string = "gemini";
    private currentModel: string = "";
    private chatHistory: { role: string, parts: { text: string }[] }[] = [];
    private URL_SERVER: string;
    private currentSessionId: string = "";
    private sessions: ChatSession[] = [];
    private createdPluginsInSession: Set<string> = new Set();
    private sendMode: string = "enter";

    // Prompt history for up/down arrow navigation
    private promptHistory: string[] = [];
    private historyIndex: number = -1;
    private tempInput: string = ""; // Store current input when navigating history

    // Voice Input
    private recognition: any;
    private isRecording: boolean = false;


    // Default models fallback
    private defaultModels: { [key: string]: { id: string, name: string }[] } = {
        gemini: [
            { id: "gemini-2.0-flash", name: "Gemini 2.0 Flash" },
            { id: "gemini-1.5-pro", name: "Gemini 1.5 Pro" },
            { id: "gemini-1.5-flash", name: "Gemini 1.5 Flash" }
        ],
        openai: [
            { id: "gpt-4o", name: "GPT-4o" },
            { id: "gpt-4-turbo", name: "GPT-4 Turbo" },
            { id: "gpt-3.5-turbo", name: "GPT-3.5 Turbo" }
        ],
        claude: [
            { id: "claude-3-5-sonnet-20240620", name: "Claude 3.5 Sonnet" },
            { id: "claude-3-opus-20240229", name: "Claude 3 Opus" },
            { id: "claude-3-haiku-20240307", name: "Claude 3 Haiku" }
        ]
    };

    private availableModels: { [key: string]: { id: string, name: string }[] } = JSON.parse(JSON.stringify(this.defaultModels));

    constructor() {
        super();
        this.shadow = this.attachShadow({ mode: "open" });
        this.URL_SERVER = BACKEND_URL;

        // Load settings
        this.loadSettings();
    }

    private loadSettings() {
        this.apiKeys.gemini = localStorage.getItem("gemini_api_key") || "";
        this.apiKeys.openai = localStorage.getItem("openai_api_key") || "";
        this.apiKeys.claude = localStorage.getItem("claude_api_key") || "";
        this.currentProvider = localStorage.getItem("selected_provider") || "gemini";
        this.currentModel = localStorage.getItem(`selected_model_${this.currentProvider}`) || this.defaultModels[this.currentProvider][0].id;
        // Load chat sessions
        try {
            const sessionsData = localStorage.getItem("ai_chat_sessions");
            this.sessions = sessionsData ? JSON.parse(sessionsData) : [];
        } catch { this.sessions = []; }

        this.sendMode = localStorage.getItem("ai_send_mode") || "enter";

        // Load prompt history
        try {
            const historyData = localStorage.getItem("ai_prompt_history");
            this.promptHistory = historyData ? JSON.parse(historyData) : [];
        } catch { this.promptHistory = []; }

        // Restore last active session if available
        const lastSessionId = localStorage.getItem("ai_current_session_id");
        if (lastSessionId && this.sessions.find(s => s.id === lastSessionId)) {
            // Will load this session after rendering
            this.currentSessionId = lastSessionId;
        } else {
            this.startNewSession();
        }
    }

    private generateId(): string {
        return Date.now().toString(36) + Math.random().toString(36).substring(2, 9);
    }

    private startNewSession() {
        this.currentSessionId = this.generateId();
        this.chatHistory = [];
        this.createdPluginsInSession = new Set();
        this.createdPluginsInSession = new Set();
        localStorage.setItem("ai_current_session_id", this.currentSessionId);
        // Note: Don't save empty session yet, save on first message
    }

    private saveCurrentSession() {
        if (this.chatHistory.length === 0) return;

        let session = this.sessions.find(s => s.id === this.currentSessionId);
        if (!session) {
            session = {
                id: this.currentSessionId,
                title: t("ai.new_chat"),
                timestamp: Date.now(),
                messages: [],
                provider: this.currentProvider,
                model: this.currentModel
            };
            this.sessions.unshift(session); // Add to beginning
        }
        session.messages = [...this.chatHistory];
        session.timestamp = Date.now();
        session.createdPlugins = Array.from(this.createdPluginsInSession);

        // Limit to 50 sessions
        if (this.sessions.length > 50) {
            this.sessions = this.sessions.slice(0, 50);
        }

        localStorage.setItem("ai_chat_sessions", JSON.stringify(this.sessions));
        localStorage.setItem("ai_current_session_id", this.currentSessionId); // Save ID for restore
        // Trigger auto-naming if needed
        this.generateSessionTitle();
    }

    private async generateSessionTitle() {
        const session = this.sessions.find(s => s.id === this.currentSessionId);
        if (!session) return;
        if (session.userEditedTitle) return; // ユーザーが編集済みなら上書きしない
        if (session.title !== t("ai.new_chat")) return; // Already named
        if (session.autoTitleAttempted) return;

        // Only auto-name after 3 user messages
        const userMessages = this.chatHistory.filter(m => m.role === "user");
        if (userMessages.length < 2) return;

        session.autoTitleAttempted = true;
        localStorage.setItem("ai_chat_sessions", JSON.stringify(this.sessions));

        const key = this.apiKeys[this.currentProvider];
        if (!key) return;

        // Build a summary request
        const summaryPrompt = `${t("ai.summary_prompt")}\n\n${this.chatHistory.slice(0, 6).map(m => `${m.role}: ${m.parts[0].text.substring(0, 200)}`).join("\n")}`;

        try {
            let title = "";
            const provider = this.currentProvider;
            const model = this.currentModel;

            if (provider === "gemini") {
                const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        contents: [{ role: "user", parts: [{ text: summaryPrompt }] }]
                    })
                });
                const data = await response.json();
                title = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "";
            } else if (provider === "openai") {
                const response = await fetch("https://api.openai.com/v1/chat/completions", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "Authorization": `Bearer ${key}`
                    },
                    body: JSON.stringify({
                        model: model,
                        messages: [{ role: "user", content: summaryPrompt }],
                        max_tokens: 50
                    })
                });
                const data = await response.json();
                title = data?.choices?.[0]?.message?.content?.trim() || "";
            } else if (provider === "claude") {
                const response = await fetch("https://api.anthropic.com/v1/messages", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "x-api-key": key,
                        "anthropic-version": "2023-06-01"
                    },
                    body: JSON.stringify({
                        model: model,
                        max_tokens: 50,
                        messages: [{ role: "user", content: summaryPrompt }]
                    })
                });
                const data = await response.json();
                title = data?.content?.[0]?.text?.trim() || "";
            }

            if (title && title.length > 0 && title.length < 50) {
                session.title = title;
                localStorage.setItem("ai_chat_sessions", JSON.stringify(this.sessions));
            }
        } catch (e) {
            console.warn("Auto-naming failed:", e);
            // Silently fail - keep default name
        }
    }

    private parseMarkdown(text: string): string {
        // Escape HTML first
        let html = text
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;");

        // Code blocks (```lang ... ```) - preserve for later processing
        const codeBlocks: string[] = [];
        html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
            const placeholder = `__CODE_BLOCK_${codeBlocks.length}__`;
            codeBlocks.push(`<pre><code class="lang-${lang}">${code.trim()}</code></pre>`);
            return placeholder;
        });

        // Inline code
        html = html.replace(/`([^`]+)`/g, "<code>$1</code>");

        // Bold
        html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
        html = html.replace(/__(.+?)__/g, "<strong>$1</strong>");

        // Italic
        html = html.replace(/\*(.+?)\*/g, "<em>$1</em>");

        // Headers
        html = html.replace(/^### (.+)$/gm, "<h4>$1</h4>");
        html = html.replace(/^## (.+)$/gm, "<h3>$1</h3>");
        html = html.replace(/^# (.+)$/gm, "<h2>$1</h2>");

        // Horizontal rule
        html = html.replace(/^---$/gm, "<hr>");

        // Unordered lists (- item or * item, with indentation support)
        // Replace list items with depth markers based on leading whitespace
        html = html.replace(/^(\s*)[-*]\s+(.+)$/gm, (_, spaces, content) => {
            const depth = Math.floor(spaces.length / 2); // 2 spaces = 1 level
            const paddingLeft = depth * 20; // 20px per level
            return `<li style="margin-left:${paddingLeft}px">${content}</li>`;
        });
        html = html.replace(/(<li[^>]*>.*<\/li>\n?)+/g, "<ul>$&</ul>");

        // Line breaks
        html = html.replace(/\n/g, "<br>");

        // Clean up
        html = html.replace(/<\/(pre|ul|h2|h3|h4)><br>/g, "</$1>");
        html = html.replace(/<hr><br>/g, "<hr>");
        html = html.replace(/<\/li><br>/g, "</li>");

        // Restore code blocks
        codeBlocks.forEach((block, i) => {
            html = html.replace(`__CODE_BLOCK_${i}__`, block);
        });

        return html;
    }

    private loadSession(sessionId: string) {
        const session = this.sessions.find(s => s.id === sessionId);
        if (session) {
            this.currentSessionId = session.id;
            this.chatHistory = [...session.messages];
            this.currentProvider = session.provider;
            this.currentModel = session.model;
            this.createdPluginsInSession = new Set(session.createdPlugins || []);

            localStorage.setItem("ai_current_session_id", this.currentSessionId);

            // Re-render chat
            const container = this.shadow.getElementById("chat-container")!;
            container.innerHTML = "";
            this.chatHistory.forEach(msg => {
                this.addMessage(msg.role as "user" | "model" | "system", msg.parts[0].text);
            });
        }
    }

    private deleteSession(sessionId: string) {
        this.sessions = this.sessions.filter(s => s.id !== sessionId);
        localStorage.setItem("ai_chat_sessions", JSON.stringify(this.sessions));
    }

    connectedCallback() {
        this.render();
        this.setupEventListeners();

        // Initial check
        if (!this.apiKeys[this.currentProvider]) {
            this.addMessage("system", t("ai.api_key_ask").replace("{provider}", this.capitalize(this.currentProvider)));
        } else if (this.currentSessionId && this.sessions.find(s => s.id === this.currentSessionId)) {
            // If restoring a session, load it
            this.loadSession(this.currentSessionId);
            // Restore draft if any
            const draft = localStorage.getItem("ai_input_draft");
            if (draft) {
                const promptInput = this.shadow.getElementById("prompt-input") as HTMLTextAreaElement;
                if (promptInput) {
                    promptInput.value = draft;
                    // Trigger expansion
                    promptInput.dispatchEvent(new Event('input'));
                }
            }
        } else {
            this.addMessage("system", ` ${t("ai.welcome")} `);
            // Try to fetch models if we have a key
            setTimeout(() => this.updateModelList(), 100);
        }

        // Restore draft functionality - ensuring DOM is ready
        setTimeout(() => {
            const draft = localStorage.getItem("ai_input_draft");
            const promptInput = this.shadow.getElementById("prompt-input") as HTMLTextAreaElement;
            if (draft && promptInput) {
                promptInput.value = draft;
                // Trigger auto-resize
                promptInput.style.height = "40px";
                promptInput.style.height = Math.min(promptInput.scrollHeight, 150) + "px";
            }
        }, 50);
    }

    private setupSpeechRecognition() {
        if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
            console.warn("Speech recognition not supported in this browser.");
            return;
        }

        const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
        this.recognition = new SpeechRecognition();
        this.recognition.continuous = false; // Stop after one sentence/phrase for chat-like experience
        this.recognition.interimResults = true;
        this.recognition.lang = "ja-JP"; // Default to Japanese as requested, or make configurable later

        this.recognition.onstart = () => {
            this.isRecording = true;
            this.updateMicButtonState();
        };

        this.recognition.onend = () => {
            this.isRecording = false;
            this.updateMicButtonState();
        };

        this.recognition.onresult = (event: any) => {
            const transcript = Array.from(event.results)
                .map((result: any) => result[0])
                .map((result: any) => result.transcript)
                .join('');

            const promptInput = this.shadow.getElementById("prompt-input") as HTMLTextAreaElement;
            if (promptInput) {
                // If interim, we might want to show it differently, but for now just replacing/appending
                // For simplicity in this text area, let's just set the value.
                // If the user already typed something, maybe append?
                // Typically voice input replaces or appends.
                // Let's go with: if input is empty, replace. If not, append.

                // NOTE: simpler approach for v1: just set value to transcript if final?
                // But with interimResults=true, we get updates constantly.

                // Let's use a "draft" approach. 
                // However, without complex cursor management, let's just use the final result or
                // just show what's being spoken.

                promptInput.value = transcript;
                promptInput.style.height = "auto";
                promptInput.style.height = Math.min(promptInput.scrollHeight, 150) + "px";
            }
        };

        this.recognition.onerror = (event: any) => {
            console.error("Speech recognition error", event.error);
            this.isRecording = false;
            this.updateMicButtonState();
        };
    }

    private toggleVoiceInput() {
        if (!this.recognition) {
            this.setupSpeechRecognition();
            if (!this.recognition) {
                alert("Voice input is not supported in this environment.");
                return;
            }
        }

        if (this.isRecording) {
            this.recognition.stop();
        } else {
            this.recognition.start();
        }
    }

    private updateMicButtonState() {
        const micBtn = this.shadow.getElementById("mic-btn") as HTMLButtonElement;
        if (!micBtn) return;

        if (this.isRecording) {
            micBtn.classList.add("recording");
            micBtn.innerHTML = `<i class="bi bi-mic-fill"></i>`;
            micBtn.title = t("ai.stop_recording") || "Stop Recording";
        } else {
            micBtn.classList.remove("recording");
            micBtn.innerHTML = `<i class="bi bi-mic"></i>`;
            micBtn.title = t("ai.start_recording") || "Voice Input";
        }
    }

    private capitalize(s: string) {
        return s.charAt(0).toUpperCase() + s.slice(1);
    }

    private render() {
        this.shadow.innerHTML = /*html*/`
        <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.10.3/font/bootstrap-icons.css">
        <style>
            :host {
                display: flex;
                flex-direction: column;
                height: 100%;
                background-color: #31353a;
                color: #e3e3e3;
                font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                border-left: 1px solid #1c1e21;
                width: 350px;
                min-width: 250px;
                max-width: 600px;
                box-sizing: border-box;
                position: relative;
            }
            #resize-handle {
                position: absolute;
                left: 0;
                top: 0;
                bottom: 0;
                width: 5px;
                cursor: ew-resize;
                background: transparent;
                z-index: 200;
            }
            #resize-handle:hover {
                background: rgba(12, 133, 208, 0.3);
            }
            #header {
                display: flex;
                align-items: center;
                justify-content: space-between;
                padding: 10px 15px;
                background-color: #212529;
                border-bottom: 1px solid #444;
            }
            #header h2 {
                margin: 0;
                font-size: 16px;
                color: #0c85d0;
            }
            #settings-btn {
                background: none;
                border: none;
                color: #aaa;
                cursor: pointer;
                font-size: 16px;
            }
            #settings-btn:hover {
                color: #fff;
            }
            #chat-container {
                flex-grow: 1;
                overflow-y: auto;
                padding: 10px;
                display: flex;
                flex-direction: column;
                gap: 10px;
            }
            .message {
                max-width: 90%;
                padding: 8px 12px;
                border-radius: 12px;
                font-size: 13px;
                line-height: 1.4;
                word-wrap: break-word;
            }
            .message.user {
                align-self: flex-end;
                background-color: #0c85d0;
                color: white;
                border-bottom-right-radius: 2px;
            }
            .message.model {
                align-self: flex-start;
                background-color: #444;
                color: #eee;
                border-bottom-left-radius: 2px;
            }
            .message.system {
                align-self: center;
                background-color: transparent;
                color: #888;
                font-style: italic;
                font-size: 12px;
            }
            #input-area {
                padding: 10px;
                background-color: #212529;
                border-top: 1px solid #444;
                display: flex;
                gap: 5px;
            }
            #prompt-input {
                flex-grow: 1;
                background-color: #31353a;
                border: 1px solid #555;
                color: white;
                border-radius: 4px;
                padding: 8px;
                resize: none;
                min-height: 40px;
                max-height: 150px;
                overflow-y: auto;
                font-family: inherit;
            }
            #prompt-input:focus {
                outline: none;
                border-color: #0c85d0;
            }
            #send-btn {
                background-color: #0c85d0;
                color: white;
                border: none;
                border-radius: 4px;
                width: 40px;
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: center;
            }
            #send-btn:hover {
                background-color: #0a74b6;
            }
            #send-btn:disabled {
                background-color: #555;
                cursor: not-allowed;
            }
            #mic-btn {
                background-color: transparent;
                color: #aaa;
                border: 1px solid #555;
                border-radius: 4px;
                width: 40px;
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: center;
                transition: all 0.2s;
            }
            #mic-btn:hover {
                color: white;
                background-color: #444;
            }
            #mic-btn.recording {
                background-color: #dc3545;
                color: white;
                border-color: #dc3545;
                animation: pulse 1.5s infinite;
            }
            @keyframes pulse {
                0% { box-shadow: 0 0 0 0 rgba(220, 53, 69, 0.4); }
                70% { box-shadow: 0 0 0 10px rgba(220, 53, 69, 0); }
                100% { box-shadow: 0 0 0 0 rgba(220, 53, 69, 0); }
            }

            
            /* Code Block Styles */
            pre {
                background: #1e1e1e;
                padding: 10px;
                border-radius: 4px;
                overflow-x: auto;
                font-family: 'Consolas', 'Monaco', monospace;
                font-size: 11px;
                position: relative;
            }
            .create-plugin-btn {
                display: block;
                width: 100%;
                margin-top: 5px;
                padding: 5px;
                background: #28a745;
                color: white;
                border: none;
                border-radius: 4px;
                cursor: pointer;
                text-align: center;
                font-size: 12px;
            }
            .create-plugin-btn:hover {
                background: #218838;
            }

            /* Settings Modal (Overlay) */
            #settings-overlay {
                display: none;
                position: absolute;
                top: 0; left: 0; right: 0; bottom: 0;
                background: rgba(0,0,0,0.8);
                align-items: center;
                justify-content: center;
                z-index: 100;
            }
            #settings-box {
                background: #31353a;
                padding: 20px;
                border-radius: 8px;
                width: 85%;
                max-width: 400px;
                text-align: left;
                display: flex;
                flex-direction: column;
                gap: 15px;
            }
            #settings-box h3 {
                margin: 0 0 10px 0;
                text-align: center;
            }
            .setting-group {
                display: flex;
                flex-direction: column;
                gap: 5px;
            }
            .setting-group label {
                font-size: 12px;
                color: #aaa;
            }
            select, input[type="password"], input[type="text"] {
                width: 100%;
                box-sizing: border-box;
                padding: 8px;
                border-radius: 4px;
                border: 1px solid #555;
                background: #222;
                color: white;
                font-family: inherit;
            }
            .model-row {
                display: flex;
                gap: 5px;
            }
            .model-row select {
                flex-grow: 1;
            }
            #refresh-models-btn {
                background: #444;
                color: white;
                border: 1px solid #555;
                border-radius: 4px;
                width: 35px;
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: center;
            }
            #refresh-models-btn:hover {
                background: #555;
            }
            #refresh-models-btn.rotating i {
                animation: spin 1s linear infinite;
            }
            @keyframes spin { 100% { transform: rotate(360deg); } }

            #save-key-btn {
                background: #0c85d0;
                color: white;
                border: none;
                padding: 10px;
                border-radius: 4px;
                cursor: pointer;
                text-align: center;
            }
            #save-key-btn:hover { background: #0a74b6; }
            #close-settings-btn {
                background: transparent;
                color: #aaa;
                border: none;
                cursor: pointer;
                text-decoration: underline;
                align-self: center;
            }
            #header-buttons {
                display: flex;
                gap: 5px;
            }
            #header-buttons button {
                background: none;
                border: none;
                color: #aaa;
                cursor: pointer;
                font-size: 14px;
                padding: 4px 6px;
            }
            #header-buttons button:hover {
                color: #fff;
            }

            /* History Overlay */
            #history-overlay {
                display: none;
                position: absolute;
                top: 0; left: 0; right: 0; bottom: 0;
                background: rgba(0,0,0,0.85);
                z-index: 100;
                flex-direction: column;
                padding: 15px;
            }
            #history-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-bottom: 10px;
            }
            #history-header h3 { margin: 0; }
            #history-search {
                width: 100%;
                padding: 8px;
                border-radius: 4px;
                border: 1px solid #555;
                background: #222;
                color: white;
                margin-bottom: 10px;
            }
            #history-list {
                flex-grow: 1;
                overflow-y: auto;
            }
            .history-item {
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 10px;
                background: #3a3f45;
                border-radius: 4px;
                margin-bottom: 5px;
                cursor: pointer;
            }
            .history-item:hover {
                background: #4a4f55;
            }
            .history-item-info {
                flex-grow: 1;
                overflow: hidden;
            }
            .history-item-title {
                font-weight: bold;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
            }
            .history-item-date {
                font-size: 11px;
                color: #888;
            }
            .history-item-delete {
                background: none;
                border: none;
                color: #888;
                cursor: pointer;
                padding: 4px;
            }
            .history-item-delete:hover {
                color: #ff6b6b;
            }
            .history-item-edit {
                background: none;
                border: none;
                color: #888;
                cursor: pointer;
                padding: 4px;
                margin-right: 5px;
            }
            .history-item-edit:hover {
                color: #6bc5ff;
            }
            .ai-content {
                margin-top: 5px;
            }
            .ai-content h2, .ai-content h3, .ai-content h4 {
                margin: 10px 0 5px 0;
            }
            .ai-content ul {
                margin: 5px 0;
                padding-left: 20px;
            }
            .ai-content li {
                margin: 2px 0;
            }
            .ai-content hr {
                border: none;
                border-top: 1px solid #555;
                margin: 10px 0;
            }
            .ai-content pre {
                background: #1a1a1a;
                padding: 10px;
                border-radius: 4px;
                overflow-x: auto;
            }
            .ai-content code {
                background: #333;
                padding: 2px 5px;
                border-radius: 3px;
                font-family: monospace;
            }
            .ai-content pre code {
                background: none;
                padding: 0;
            }
            /* Loading indicator */
            #loading-indicator {
                display: none;
                align-self: flex-start;
                padding: 8px 12px;
                background-color: #444;
                border-radius: 12px;
                border-bottom-left-radius: 2px;
                font-size: 13px;
                color: #aaa;
            }
            #loading-indicator.visible {
                display: block;
            }
            .loading-dots {
                display: inline-block;
            }
            .loading-dots::after {
                content: '';
                animation: dots 1.5s steps(4, end) infinite;
            }
            @keyframes dots {
                0% { content: ''; }
                25% { content: '.'; }
                50% { content: '..'; }
                75% { content: '...'; }
                100% { content: ''; }
            }
        </style>

        <div id="resize-handle"></div>

        <div id="header">
            <h2>${t("ai.title")} <i class="bi bi-robot"></i></h2>
            <div id="header-buttons">
                <button id="new-chat-btn" title="${t("ai.new_chat")}"><i class="bi bi-plus-lg"></i></button>
                <button id="history-btn" title="${t("ai.history")}"><i class="bi bi-clock-history"></i></button>
                <button id="settings-btn" title="${t("ai.settings")}"><i class="bi bi-gear-fill"></i></button>
            </div>
        </div>

        <div id="settings-overlay">
            <div id="settings-box">
                <h3>${t("ai.settings")}</h3>
                
                <div class="setting-group">
                    <label>${t("ai.provider")}</label>
                    <select id="provider-select">
                        <option value="gemini">Google Gemini</option>
                        <option value="openai">OpenAI (ChatGPT)</option>
                        <option value="claude">Anthropic Claude</option>
                    </select>
                </div>

                <div class="setting-group">
                    <label>${t("ai.model")}</label>
                    <div class="model-row">
                        <select id="model-select"></select>
                        <button id="refresh-models-btn" title="${t("ai.models_refresh")}"><i class="bi bi-arrow-clockwise"></i></button>
                    </div>
                </div>

                <div class="setting-group">
                    <label id="api-key-label">${t("ai.api_key_label").replace("{provider}", "Gemini")}</label>
                    <input type="password" id="api-key-input" placeholder="${t("ai.api_key_placeholder")}" />
                </div>

                <div class="setting-group">
                    <label>${t("ai.send_mode")}</label>
                    <select id="send-mode-select">
                        <option value="enter">${t("ai.send_mode.enter")}</option>
                        <option value="ctrl_enter">${t("ai.send_mode.ctrl_enter")}</option>
                    </select>
                </div>

                <button id="save-key-btn">${t("ai.save_settings")}</button>
                <button id="close-settings-btn">${t("ai.close")}</button>
            </div>
        </div>

        <div id="history-overlay">
            <div id="history-header">
                <h3>${t("ai.history")}</h3>
                <button id="close-history-btn">${t("ai.close")}</button>
            </div>
            <input type="text" id="history-search" placeholder="${t("ai.search_history")}" />
            <div id="history-list"></div>
        </div>

        <div id="chat-container"></div>

        <div id="input-area">
            <textarea id="prompt-input" placeholder="${t("ai.placeholder")}"></textarea>
            <button id="mic-btn" title="${t("ai.voice_input") || "Voice Input"}"><i class="bi bi-mic"></i></button>
            <button id="send-btn"><i class="bi bi-send-fill"></i></button>
        </div>
        `;
    }

    private setupEventListeners() {
        const sendBtn = this.shadow.getElementById("send-btn") as HTMLButtonElement;
        const micBtn = this.shadow.getElementById("mic-btn") as HTMLButtonElement;
        const promptInput = this.shadow.getElementById("prompt-input") as HTMLTextAreaElement;
        const settingsBtn = this.shadow.getElementById("settings-btn") as HTMLButtonElement;
        const settingsOverlay = this.shadow.getElementById("settings-overlay") as HTMLDivElement;
        const saveKeyBtn = this.shadow.getElementById("save-key-btn") as HTMLButtonElement;
        const closeSettingsBtn = this.shadow.getElementById("close-settings-btn") as HTMLButtonElement;

        const providerSelect = this.shadow.getElementById("provider-select") as HTMLSelectElement;
        const modelSelect = this.shadow.getElementById("model-select") as HTMLSelectElement;
        const refreshBtn = this.shadow.getElementById("refresh-models-btn") as HTMLButtonElement;
        const apiKeyInput = this.shadow.getElementById("api-key-input") as HTMLInputElement;
        const apiKeyLabel = this.shadow.getElementById("api-key-label") as HTMLLabelElement;
        const sendModeSelect = this.shadow.getElementById("send-mode-select") as HTMLSelectElement;

        const newChatBtn = this.shadow.getElementById("new-chat-btn") as HTMLButtonElement;
        const historyBtn = this.shadow.getElementById("history-btn") as HTMLButtonElement;
        const historyOverlay = this.shadow.getElementById("history-overlay") as HTMLDivElement;
        const closeHistoryBtn = this.shadow.getElementById("close-history-btn") as HTMLButtonElement;
        const historySearch = this.shadow.getElementById("history-search") as HTMLInputElement;
        const historyList = this.shadow.getElementById("history-list") as HTMLDivElement;

        // --- Settings Interaction ---

        const updateUIForProvider = () => {
            const provider = providerSelect.value;
            this.currentProvider = provider;

            // 【追加】このプロバイダで前回保存されたモデルがあれば復元する
            const savedModel = localStorage.getItem(`selected_model_${provider}`);
            if (savedModel) {
                this.currentModel = savedModel;
            }

            // Label
            apiKeyLabel.innerText = t("ai.api_key_label").replace("{provider}", this.capitalize(provider));
            // Input value
            apiKeyInput.value = this.apiKeys[provider] || "";

            // Populate models
            this.populateModelSelect();
        };

        providerSelect.addEventListener("change", () => {
            updateUIForProvider();
            // Try to auto-refresh models if key exists
            if (this.apiKeys[this.currentProvider]) {
                this.updateModelList();
            }
        });

        modelSelect.addEventListener("change", () => {
            this.currentModel = modelSelect.value;
            localStorage.setItem(`selected_model_${this.currentProvider}`, this.currentModel);
        });

        refreshBtn.addEventListener("click", () => {
            this.updateModelList();
        });

        // Open Settings
        settingsBtn.addEventListener("click", () => {
            // Sync UI state
            providerSelect.value = this.currentProvider;
            sendModeSelect.value = this.sendMode;
            updateUIForProvider();
            settingsOverlay.style.display = "flex";

            // Auto-refresh models if key exists
            if (this.apiKeys[this.currentProvider]) {
                this.updateModelList();
            }
        });

        // Close Settings
        const closeSettings = () => {
            settingsOverlay.style.display = "none";
        };
        closeSettingsBtn.addEventListener("click", closeSettings);

        // Save Settings
        saveKeyBtn.addEventListener("click", () => {
            const provider = providerSelect.value;
            const key = apiKeyInput.value.trim();
            const model = modelSelect.value;
            const mode = sendModeSelect.value;

            this.apiKeys[provider] = key;
            this.currentProvider = provider;
            this.currentModel = model;
            this.sendMode = mode;

            localStorage.setItem(`${provider}_api_key`, key);
            localStorage.setItem("selected_provider", provider);
            localStorage.setItem(`selected_model_${provider}`, model);
            localStorage.setItem("ai_send_mode", mode);

            this.addMessage("system", t("ai.settings_saved").replace("{provider}", this.capitalize(provider)));

            // Verify fetch models
            if (key) {
                this.updateModelList().then(() => closeSettings());
            } else {
                closeSettings();
            }
        });


        // --- Chat Interaction ---

        const handleSend = () => {
            const text = promptInput.value.trim();
            if (!text) return;

            // Stop recording if active
            if (this.isRecording && this.recognition) {
                this.recognition.stop();
            }

            // Check key
            if (!this.apiKeys[this.currentProvider]) {
                this.addMessage("system", t("ai.api_key_missing_action").replace("{provider}", this.capitalize(this.currentProvider)));
                settingsOverlay.style.display = "flex";
                return;
            }

            this.addMessage("user", text);
            // Add to prompt history
            this.promptHistory.push(text);
            if (this.promptHistory.length > 50) this.promptHistory.shift();
            localStorage.setItem("ai_prompt_history", JSON.stringify(this.promptHistory));
            this.historyIndex = -1; // Reset index

            promptInput.value = "";
            localStorage.removeItem("ai_input_draft"); // Clear draft
            promptInput.style.height = "40px"; // Reset height after send
            this.sendMessageToAI(text);
        };

        sendBtn.addEventListener("click", handleSend);
        micBtn.addEventListener("click", () => this.toggleVoiceInput());
        sendBtn.addEventListener("click", handleSend);
        promptInput.addEventListener("keydown", (e) => {
            const isEnter = e.key === "Enter";
            if (!isEnter) {
                // Handle Arrow keys in next block
            } else {
                // If IME Composition is active, do nothing
                if (e.isComposing) return;

                if (this.sendMode === "enter") {
                    if (!e.shiftKey) {
                        e.preventDefault();
                        handleSend();
                        return;
                    }
                } else if (this.sendMode === "ctrl_enter") {
                    if (e.ctrlKey || e.metaKey) {
                        e.preventDefault();
                        handleSend();
                        return;
                    }
                }
            }

            // History navigation (Up/Down)
            if (e.key === "ArrowUp") {
                // If cursor is at start of first line (or selection is empty)
                const isAtStart = promptInput.selectionStart === 0 && promptInput.selectionEnd === 0;
                if (isAtStart) {
                    e.preventDefault();
                    if (this.historyIndex === -1) {
                        // Save current draft before moving up
                        this.tempInput = promptInput.value;
                        this.historyIndex = this.promptHistory.length - 1;
                    } else {
                        this.historyIndex = Math.max(0, this.historyIndex - 1);
                    }

                    if (this.historyIndex >= 0 && this.promptHistory[this.historyIndex]) {
                        promptInput.value = this.promptHistory[this.historyIndex];
                        // Move cursor to end needed? Usually standard console behavior moves to end, let's do it
                        // waiting for end of frame? no just execute
                        // Actually console usually keeps cursor position or moves to end.
                    }
                }
            } else if (e.key === "ArrowDown") {
                // If cursor is at end (or we are just navigating history logic?)
                // Usually allow navigation if we are actively browsing history.
                // But simplified check: if historyIndex is active
                if (this.historyIndex !== -1) {
                    e.preventDefault();
                    if (this.historyIndex < this.promptHistory.length - 1) {
                        this.historyIndex++;
                        promptInput.value = this.promptHistory[this.historyIndex];
                    } else {
                        // Back to temp input
                        this.historyIndex = -1;
                        promptInput.value = this.tempInput;
                    }
                }
            }
        });

        // Auto-resize textarea as user types & Save Draft
        promptInput.addEventListener("input", () => {
            promptInput.style.height = "40px"; // Reset first
            promptInput.style.height = Math.min(promptInput.scrollHeight, 150) + "px";

            // Save draft
            localStorage.setItem("ai_input_draft", promptInput.value);
        });

        // New Chat Button
        newChatBtn.addEventListener("click", () => {
            this.startNewSession();
            const container = this.shadow.getElementById("chat-container")!;
            container.innerHTML = "";
            this.addMessage("system", t("ai.welcome"));
        });

        // History Button
        const renderHistoryList = (filter: string = "") => {
            historyList.innerHTML = "";
            const filtered = this.sessions.filter(s =>
                s.title.toLowerCase().includes(filter.toLowerCase()) ||
                s.messages.some(m => m.parts[0].text.toLowerCase().includes(filter.toLowerCase()))
            );
            if (filtered.length === 0) {
                historyList.innerHTML = `<p style="color:#888;text-align:center;">${t("ai.no_history")}</p>`;
                return;
            }
            filtered.forEach(session => {
                const item = document.createElement("div");
                item.className = "history-item";
                item.innerHTML = `
                    <div class="history-item-info">
                        <div class="history-item-title">${session.title}</div>
                        <div class="history-item-date">${new Date(session.timestamp).toLocaleString()}</div>
                    </div>
                    <button class="history-item-edit" title="${t("ai.history.edit")}"><i class="bi bi-pencil"></i></button>
                    <button class="history-item-delete" title="${t("ai.history.delete")}"><i class="bi bi-trash"></i></button>
                `;
                item.querySelector(".history-item-edit")!.addEventListener("click", (e) => {
                    e.stopPropagation();
                    const newTitle = prompt(t("ai.history.rename_prompt"), session.title);
                    if (newTitle && newTitle.trim()) {
                        session.title = newTitle.trim();
                        session.userEditedTitle = true;
                        localStorage.setItem("ai_chat_sessions", JSON.stringify(this.sessions));
                        renderHistoryList(historySearch.value);
                    }
                });
                item.querySelector(".history-item-delete")!.addEventListener("click", async (e) => {
                    e.stopPropagation();
                    const confirmed = await confirm(t("ai.delete_confirm"));
                    if (confirmed) {
                        this.deleteSession(session.id);
                        renderHistoryList(historySearch.value);
                    }
                });
                // Click on info to load session
                item.querySelector(".history-item-info")!.addEventListener("click", () => {
                    this.loadSession(session.id);
                    historyOverlay.style.display = "none";
                });
                historyList.appendChild(item);
            });
        };

        historyBtn.addEventListener("click", () => {
            historySearch.value = "";
            renderHistoryList();
            historyOverlay.style.display = "flex";
        });

        closeHistoryBtn.addEventListener("click", () => {
            historyOverlay.style.display = "none";
        });

        historySearch.addEventListener("input", () => {
            renderHistoryList(historySearch.value);
        });

        // --- Resize Handle ---
        const resizeHandle = this.shadow.getElementById("resize-handle") as HTMLDivElement;
        let isResizing = false;
        let startX = 0;
        let startWidth = 0;

        resizeHandle.addEventListener("mousedown", (e: MouseEvent) => {
            isResizing = true;
            startX = e.clientX;
            startWidth = this.offsetWidth;
            document.body.style.cursor = "ew-resize";
            document.body.style.userSelect = "none";
            e.preventDefault();
        });

        document.addEventListener("mousemove", (e: MouseEvent) => {
            if (!isResizing) return;
            const diff = startX - e.clientX;
            const newWidth = Math.min(600, Math.max(250, startWidth + diff));
            this.style.width = `${newWidth}px`;
        });

        document.addEventListener("mouseup", () => {
            if (isResizing) {
                isResizing = false;
                document.body.style.cursor = "";
                document.body.style.userSelect = "";
                // Save width preference
                localStorage.setItem("ai_sidebar_width", this.style.width);
            }
        });

        // Restore saved width
        const savedWidth = localStorage.getItem("ai_sidebar_width");
        if (savedWidth) {
            this.style.width = savedWidth;
        }
    }

    private populateModelSelect() {
        const modelSelect = this.shadow.getElementById("model-select") as HTMLSelectElement;
        const provider = this.currentProvider;
        const models = this.availableModels[provider] || [];

        modelSelect.innerHTML = "";

        let foundCurrent = false;
        models.forEach(m => {
            const opt = document.createElement("option");
            opt.value = m.id;
            opt.innerText = m.name;
            if (m.id === this.currentModel) foundCurrent = true;
            modelSelect.appendChild(opt);
        });

        // Select current if exists, else first
        if (foundCurrent) {
            modelSelect.value = this.currentModel;
        } else if (models.length > 0) {
            modelSelect.value = models[0].id;
            this.currentModel = models[0].id;
        }
    }

    private async updateModelList() {
        const refreshBtn = this.shadow.getElementById("refresh-models-btn") as HTMLButtonElement;
        refreshBtn.classList.add("rotating");

        const provider = this.currentProvider;
        const key = this.apiKeys[provider];

        if (!key) {
            refreshBtn.classList.remove("rotating");
            return;
        }

        try {
            let models: { id: string, name: string }[] = [];

            if (provider === "gemini") {
                const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}`);
                const data = await response.json();
                if (data.models) {
                    models = data.models
                        .filter((m: any) => {
                            // 1. Must support generateContent
                            if (!m.supportedGenerationMethods?.includes("generateContent")) return false;

                            const name = (m.name || "").toLowerCase();

                            // 2. Must be a "gemini" or "learnlm" model
                            if (!name.includes("gemini") && !name.includes("learnlm")) return false;

                            // 3. Eliminate models that are likely to produce errors
                            if (name.includes("embedding")) return false;
                            if (name.includes("aqa")) return false;
                            if (name.includes("image")) return false;
                            if (name.includes("tts")) return false;
                            if (name.includes("robotics")) return false;
                            if (name.includes("preview")) return false;
                            if (name.includes("latest")) return false;
                            if (name.includes("-exp-")) return false;
                            if (name.includes("-001")) return false;
                            if (name.includes("gemini-2.0")) return false;


                            return true;
                        })
                        .map((m: any) => ({
                            id: m.name.replace("models/", ""), // Remove 'models/' prefix
                            name: m.displayName || m.name
                        }));
                    // Sort so newest/pro are top?
                    models.sort((a, b) => b.id.localeCompare(a.id));
                }
            } else if (provider === "openai") {
                const response = await fetch("https://api.openai.com/v1/models", {
                    headers: { "Authorization": `Bearer ${key}` }
                });
                const data = await response.json();
                if (data.data) {
                    models = data.data
                        .filter((m: any) => m.id.includes("gpt")) // Simple filter
                        .map((m: any) => ({ id: m.id, name: m.id }))
                        .sort((a: any, b: any) => b.id.localeCompare(a.id));
                }
            } else if (provider === "claude") {
                // Anthropic requires a proxy or server-side call often due to CORS. 
                // However, we can try direct. If fails, we fallback.
                // NOTE: Anthropic API typically does not support direct browser calls easily due to CORS headers unless configured.
                // We will simulate or try to fetch.
                throw new Error("Dynamic fetching for Claude requires a backend proxy due to CORS.");
            }

            if (models.length > 0) {
                this.availableModels[provider] = models;
                this.populateModelSelect();
                // Ensure selection persists
                if (models.some(m => m.id === this.currentModel)) {
                    // Fine
                } else {
                    this.currentModel = models[0].id;
                    localStorage.setItem(`selected_model_${provider}`, this.currentModel);
                }
            }

        } catch (e) {
            console.warn(`Failed to fetch models for ${provider}:`, e);
            // Don't show error to user, just stick to defaults, maybe show small toast?
        } finally {
            refreshBtn.classList.remove("rotating");
            this.populateModelSelect(); // Refresh UI in case we updated or failed
        }
    }

    private addMessage(role: "user" | "model" | "system", text: string) {
        const container = this.shadow.getElementById("chat-container")!;
        const msgDiv = document.createElement("div");
        msgDiv.className = `message ${role}`;

        if (role === "model") {
            // Basic markdown parsing for code blocks
            const codeBlockRegex = /```typescript([\s\S]*?)```/g;
            let lastIndex = 0;
            let match;

            while ((match = codeBlockRegex.exec(text)) !== null) {
                // Add text before code
                const before = text.substring(lastIndex, match.index);
                if (before.trim()) {
                    const p = document.createElement("div");
                    p.className = "ai-content";
                    p.innerHTML = this.parseMarkdown(before);
                    msgDiv.appendChild(p);
                }

                // Add Code Block
                const code = match[1].trim();
                const pre = document.createElement("pre");
                pre.innerText = code;
                msgDiv.appendChild(pre);

                // Add "Create Plugin" button
                const btn = document.createElement("button");
                btn.className = "create-plugin-btn";
                // Try to infer filename or ask user?
                const classNameMatch = code.match(/class\s+(\w+)/);
                const className = classNameMatch ? classNameMatch[1] : "GeneratedPlugin";

                // Check if this plugin was already created in this session
                if (this.createdPluginsInSession.has(className)) {
                    btn.disabled = true;
                    btn.innerHTML = `<i class='bi bi-check-lg'></i> ${t("ai.plugin_created")}`;
                    btn.style.backgroundColor = "#28a745";
                    btn.style.cursor = "default";
                } else {
                    btn.innerHTML = `<i class='bi bi-tools'></i> ${t("ai.create_plugin")}`;
                    btn.onclick = async () => {
                        const success = await this.createPlugin(className, code);
                        if (success) {
                            // Change button to "Created!" state
                            btn.disabled = true;
                            btn.innerHTML = `<i class='bi bi-check-lg'></i> ${t("ai.plugin_created")}`;
                            btn.style.backgroundColor = "#28a745";
                            btn.style.cursor = "default";
                            // Track in session
                            this.createdPluginsInSession.add(className);
                            this.saveCurrentSession();
                        }
                    };
                }
                msgDiv.appendChild(btn);

                lastIndex = codeBlockRegex.lastIndex;
            }

            // Add text after last code
            const after = text.substring(lastIndex);
            if (after.trim()) {
                const p = document.createElement("div");
                p.className = "ai-content";
                p.innerHTML = this.parseMarkdown(after);
                msgDiv.appendChild(p);
            }

            if (lastIndex === 0) {
                // No code blocks - use markdown parser
                msgDiv.innerHTML = `<div class="ai-content">${this.parseMarkdown(text)}</div>`;
            }

        } else {
            msgDiv.innerText = text;
        }

        container.appendChild(msgDiv);
        container.scrollTop = container.scrollHeight;
    }

    private escapeHtml(text: string) {
        return text
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    private validatePluginCode(text: string): string[] {
        const errors: string[] = [];

        // Only validate if there is a typescript code block
        if (!text.includes("```typescript")) return [];

        // 1. Check for @DAWIYPlugin arguments
        if (/@DAWIYPlugin\s*\(\s*\{/.test(text)) {
            errors.push("CRITICAL: @DAWIYPlugin decorator must NOT have arguments. Define 'name', 'id', 'author', etc. as class properties inside the class.");
        }

        // 2. Check for midiController
        if (/\.midiController/.test(text)) {
            errors.push("CRITICAL: 'midiController' property does not exist on App. Use 'this.app.settingsController.on_midi_message' to subscribe to MIDI events.");
        }

        // 3. Check for destroy()
        if (/destroy\s*\(\)\s*\{/.test(text)) {
            errors.push("CRITICAL: 'destroy()' method is not supported or called automatically. Use 'onDeactivate()' for cleanup (removing listeners, etc.).");
        }

        // 4. Check for incorrect imports (React/Vue)
        if (/from\s+['"](react|vue|@angular)['"]/.test(text)) {
            errors.push("CRITICAL: External UI frameworks (React, Vue, etc.) are NOT supported. Use standard DOM API (document.createElement, innerHTML).");
        }

        return errors;
    }

    private async sendMessageToAI(userText: string) {
        const sendBtn = this.shadow.getElementById("send-btn") as HTMLButtonElement;
        const chatContainer = this.shadow.getElementById("chat-container") as HTMLDivElement;

        sendBtn.disabled = true;

        // Create and append loading indicator at the bottom
        let loadingIndicator = document.createElement("div");
        loadingIndicator.id = "loading-indicator";
        loadingIndicator.className = "visible";
        loadingIndicator.innerHTML = `${t("ai.thinking")}<span class="loading-dots"></span>`;
        chatContainer.appendChild(loadingIndicator);
        chatContainer.scrollTop = chatContainer.scrollHeight;

        const provider = this.currentProvider;
        const key = this.apiKeys[provider];
        const model = this.currentModel;

        try {
            // Add user message to history immediately
            this.chatHistory.push({ role: "user", parts: [{ text: userText }] });

            let retryCount = 0;
            const MAX_RETRIES = 2; // Allow self-correction up to 2 times

            while (true) {
                // Prepare history for API (last 10 messages + current accumulation in loop)
                // We use the FULL chatHistory here because we might have appended error prompts in previous loop iterations
                const contextHistory = this.chatHistory.slice(-15);

                let reply = "No response.";

                if (provider === "gemini") {
                    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            contents: [
                                { role: "user", parts: [{ text: SYSTEM_PROMPT }] },
                                ...contextHistory
                            ]
                        })
                    });

                    if (!response.ok) {
                        const err = await response.json();
                        throw new Error(err.error?.message || response.statusText);
                    }
                    const data = await response.json();
                    reply = data.candidates?.[0]?.content?.parts?.[0]?.text || "No response.";
                }
                else if (provider === "openai") {
                    const response = await fetch("https://api.openai.com/v1/chat/completions", {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/json",
                            "Authorization": `Bearer ${key}`
                        },
                        body: JSON.stringify({
                            model: model,
                            messages: [
                                { role: "system", content: SYSTEM_PROMPT },
                                ...contextHistory.map(h => ({ role: h.role === "model" ? "assistant" : "user", content: h.parts[0].text }))
                            ]
                        })
                    });

                    if (!response.ok) {
                        const err = await response.json();
                        throw new Error(err.error?.message || response.statusText);
                    }
                    const data = await response.json();
                    reply = data.choices[0]?.message?.content || "No response.";
                }
                else if (provider === "claude") {
                    const response = await fetch("https://api.anthropic.com/v1/messages", {
                        method: "POST",
                        headers: {
                            "x-api-key": key,
                            "anthropic-version": "2023-06-01",
                            "content-type": "application/json"
                        },
                        body: JSON.stringify({
                            model: model,
                            max_tokens: 4096,
                            system: SYSTEM_PROMPT,
                            messages: [
                                ...contextHistory.map(h => ({ role: h.role === "model" ? "assistant" : "user", content: h.parts[0].text }))
                            ]
                        })
                    });

                    if (!response.ok) {
                        throw new Error("Claude API request failed.");
                    }
                    const data = await response.json();
                    reply = data.content[0]?.text || "No response.";
                }

                // --- VALIDATION AND SELF-CORRECTION LOOP ---
                const validationErrors = this.validatePluginCode(reply);

                if (validationErrors.length > 0 && retryCount < MAX_RETRIES) {
                    console.warn(`[AI-LINT] Found errors (Attempt ${retryCount + 1}):`, validationErrors);

                    // 1. Add the failed reply to history internally (so the model knows what it wrote)
                    this.chatHistory.push({ role: "model", parts: [{ text: reply }] });

                    // 2. Add the error prompt
                    const correctionPrompt = `SYSTEM (Self-Correction): The code you just generated contains CRITICAL ERRORS that violate safety rules. You MUST fix them immediately:\n\n${validationErrors.map(e => "- " + e).join("\n")}\n\nOutput the FULL corrected file again.`;
                    this.chatHistory.push({ role: "user", parts: [{ text: correctionPrompt }] });

                    // 3. Update Status Indicator to show we are fixing
                    const dots = loadingIndicator.querySelector(".loading-dots");
                    if (dots) dots.innerHTML = ""; // Reset animation slightly or change text
                    loadingIndicator.innerHTML = `${t("ai.thinking")} ${t("ai.fixing_errors")}<span class="loading-dots"></span>`;

                    retryCount++;
                    continue; // Loop again to fetch correction
                }

                // Success or Max Retries reached
                if (validationErrors.length > 0) {
                    // If we still have errors after retries, maybe append a warning to the reply?
                    reply += `\n\n> [!WARNING]\n> ${t("ai.plugin_error")} ${t("ai.validation_failed")}`;
                }

                // Update internal history with final reply
                this.chatHistory.push({ role: "model", parts: [{ text: reply }] });
                this.addMessage("model", reply);
                break;
            }

        } catch (e: any) {
            this.addMessage("system", t("ai.generic_error") + e.message);
        } finally {
            this.saveCurrentSession();
            sendBtn.disabled = false;
            loadingIndicator.remove();
        }
    }

    private async createPlugin(className: string, code: string): Promise<boolean> {
        // Enforce subdirectory structure: ClassName/ClassName.ts
        // This ensures relative imports like "../../App" work correctly.
        const filename = `${className}/${className}.ts`;
        const confirmed = await confirm(t("ai.create_plugin_confirm").replace("{filename}", filename));
        if (!confirmed) return false;

        try {
            // Use relative path to target the Webpack Dev Server directly (same origin)
            const response = await fetch('/upload-plugin', {
                method: 'POST',
                headers: {
                    'Content-Type': 'text/plain',
                    'x-filename': filename
                },
                body: code
            });

            if (response.ok) {
                this.addMessage("system", t("ai.plugin_success").replace("{filename}", filename));
                return true;
            } else {
                const text = await response.text();
                this.addMessage("system", t("ai.plugin_failed") + text);
                return false;
            }
        } catch (e: any) {
            this.addMessage("system", t("ai.plugin_error") + e.message);
            return false;
        }
    }
}

window.customElements.define('ai-assistant-sidebar', AiAssistantSidebar);
