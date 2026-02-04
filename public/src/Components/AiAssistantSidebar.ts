
import { BACKEND_URL } from "../Env";

const SYSTEM_PROMPT = `
You are an expert DAWIY Plugin Developer. Your task is to create TypeScript plugins for DAWIY based on user requests.

# Plugin Rules (CRITICAL):
1. Class MUST extend \`DawiyPluginBase\`.
2. Class MUST use \`@DAWIYPlugin\` decorator.
3. Class MUST be the \`default export\`.
4. Constructor MUST match: \`constructor(app: App) { super(app); }\`.
5. Implement \`render(container: HTMLElement)\` to build UI.
6. Use \`this.app\` to access DAWIY features (e.g., \`this.app.tracksController\`).
7. Do NOT use external imports (like 'react' or 'vue'). use \`document.createElement\`.
8. Imports MUST be:
   \`import App from "../../App";\`
   \`import { DAWIYPlugin } from "../IDawiyPlugin";\`
   \`import DawiyPluginBase from "../DawiyPluginBase";\`

# Example:
\`\`\`typescript
import App from "../../App";
import { DAWIYPlugin } from "../IDawiyPlugin";
import DawiyPluginBase from "../DawiyPluginBase";

@DAWIYPlugin
export default class MyPlugin extends DawiyPluginBase {
    id = "simple-logger";
    name = "Simple Logger";
    description = "Logs to console";

    constructor(app: App) {
        super(app);
    }

    public override render(container: HTMLElement) {
        container.innerHTML = "<h3>Logger</h3><button id='btn'>Log</button>";
        container.querySelector("#btn")!.addEventListener("click", () => {
             console.log("Hello from Plugin!");
        });
    }
}
\`\`\`

If you generate code, please wrap it in a code block with \`typescript\` language identifier.
Ensure the code is complete and runnable.
Also, suggest a filename for the plugin (e.g., \`MyPlugin.ts\`) at the beginning of your response or before the code block.
`;

export default class AiAssistantSidebar extends HTMLElement {
    private shadow: ShadowRoot;
    private apiKey: string = "";
    private chatHistory: { role: string, parts: { text: string }[] }[] = [];
    private URL_SERVER: string;

    constructor() {
        super();
        this.shadow = this.attachShadow({ mode: "open" });
        this.URL_SERVER = BACKEND_URL;
        // Load API Key from localStorage
        this.apiKey = localStorage.getItem("gemini_api_key") || "";
    }

    connectedCallback() {
        this.render();
        this.setupEventListeners();
        if (!this.apiKey) {
            this.addMessage("system", "Please set your Gemini API Key in the settings (gear icon).");
        } else {
            this.addMessage("system", "Hello! I am your AI Plugin Assistant. Ask me to create a plugin!");
        }
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
                width: 300px;
                box-sizing: border-box;
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
                height: 40px;
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
                width: 80%;
                text-align: center;
            }
            #api-key-input {
                width: 100%;
                padding: 8px;
                margin: 10px 0;
                border-radius: 4px;
                border: 1px solid #555;
                background: #222;
                color: white;
            }
            #save-key-btn {
                background: #0c85d0;
                color: white;
                border: none;
                padding: 8px 16px;
                border-radius: 4px;
                cursor: pointer;
            }
             #close-settings-btn {
                background: transparent;
                color: #aaa;
                border: none;
                margin-top: 10px;
                cursor: pointer;
                text-decoration: underline;
            }
        </style>

        <div id="header">
            <h2>AI Assistant <i class="bi bi-robot"></i></h2>
            <button id="settings-btn"><i class="bi bi-gear-fill"></i></button>
        </div>

        <div id="settings-overlay">
            <div id="settings-box">
                <h3>Settings</h3>
                <p>Enter your Google Gemini API Key</p>
                <input type="password" id="api-key-input" placeholder="API Key" />
                <button id="save-key-btn">Save</button>
                <br>
                <button id="close-settings-btn">Close</button>
            </div>
        </div>

        <div id="chat-container"></div>

        <div id="input-area">
            <textarea id="prompt-input" placeholder="Describe the plugin you want..."></textarea>
            <button id="send-btn"><i class="bi bi-send-fill"></i></button>
        </div>
        `;
    }

    private setupEventListeners() {
        const sendBtn = this.shadow.getElementById("send-btn") as HTMLButtonElement;
        const promptInput = this.shadow.getElementById("prompt-input") as HTMLTextAreaElement;
        const settingsBtn = this.shadow.getElementById("settings-btn") as HTMLButtonElement;
        const settingsOverlay = this.shadow.getElementById("settings-overlay") as HTMLDivElement;
        const saveKeyBtn = this.shadow.getElementById("save-key-btn") as HTMLButtonElement;
        const closeSettingsBtn = this.shadow.getElementById("close-settings-btn") as HTMLButtonElement;
        const apiKeyInput = this.shadow.getElementById("api-key-input") as HTMLInputElement;

        // Send Message
        const handleSend = () => {
            const text = promptInput.value.trim();
            if (!text) return;
            if (!this.apiKey) {
                this.addMessage("system", "Please set your API Key first.");
                settingsOverlay.style.display = "flex";
                return;
            }

            this.addMessage("user", text);
            promptInput.value = "";
            this.sendMessageToAI(text);
        };

        sendBtn.addEventListener("click", handleSend);
        promptInput.addEventListener("keydown", (e) => {
            if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend();
            }
        });

        // Settings
        settingsBtn.addEventListener("click", () => {
            apiKeyInput.value = this.apiKey;
            settingsOverlay.style.display = "flex";
        });

        const closeSettings = () => {
            settingsOverlay.style.display = "none";
        };

        closeSettingsBtn.addEventListener("click", closeSettings);

        saveKeyBtn.addEventListener("click", () => {
            const key = apiKeyInput.value.trim();
            if (key) {
                this.apiKey = key;
                localStorage.setItem("gemini_api_key", key);
                this.addMessage("system", "API Key saved.");
                closeSettings();
            }
        });
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
                    p.innerHTML = this.escapeHtml(before).replace(/\n/g, "<br>");
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
                btn.innerHTML = "<i class='bi bi-tools'></i> Create/Update Plugin";
                // Try to infer filename or ask user? For now default or infer.
                // We'll try to find a class name
                const classNameMatch = code.match(/class\s+(\w+)/);
                const className = classNameMatch ? classNameMatch[1] : "GeneratedPlugin";

                btn.onclick = () => this.createPlugin(className, code);
                msgDiv.appendChild(btn);

                lastIndex = codeBlockRegex.lastIndex;
            }

            // Add text after last code
            const after = text.substring(lastIndex);
            if (after.trim()) {
                const p = document.createElement("div");
                p.innerHTML = this.escapeHtml(after).replace(/\n/g, "<br>");
                msgDiv.appendChild(p);
            }

            if (lastIndex === 0) {
                // No code blocks
                msgDiv.innerHTML = this.escapeHtml(text).replace(/\n/g, "<br>");
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

    private async sendMessageToAI(userText: string) {
        const sendBtn = this.shadow.getElementById("send-btn") as HTMLButtonElement;
        sendBtn.disabled = true;

        // Diagnostic: list models
        if (userText.trim() === "/models") {
            try {
                const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${this.apiKey}`);
                const data = await response.json();
                if (data.models) {
                    const modelNames = data.models.map((m: any) => m.name).join("<br>");
                    this.addMessage("system", "Available Models:<br>" + modelNames);
                } else {
                    this.addMessage("system", "No models found or error: " + JSON.stringify(data));
                }
            } catch (e: any) {
                this.addMessage("system", "Error fetching models: " + e.message);
            } finally {
                sendBtn.disabled = false;
            }
            return;
        }

        // Prepare Chat History for API
        // Limit history to last 10 turns to save tokens
        const history = this.chatHistory.slice(-10);

        try {
            // Updated to gemini-2.0-flash
            const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${this.apiKey}`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    contents: [
                        { role: "user", parts: [{ text: SYSTEM_PROMPT }] }, // Inject System Prompt as first user msg (or simulate)
                        ...history,
                        { role: "user", parts: [{ text: userText }] }
                    ]
                })
            });

            if (!response.ok) {
                const err = await response.json();
                throw new Error(err.error?.message || "API Error");
            }

            const data = await response.json();
            const reply = data.candidates?.[0]?.content?.parts?.[0]?.text || "No response.";

            // Update internal history
            this.chatHistory.push({ role: "user", parts: [{ text: userText }] });
            this.chatHistory.push({ role: "model", parts: [{ text: reply }] });

            this.addMessage("model", reply);

        } catch (e: any) {
            this.addMessage("system", "Error: " + e.message);
        } finally {
            sendBtn.disabled = false;
        }
    }

    private async createPlugin(className: string, code: string) {
        // Enforce subdirectory structure: ClassName/ClassName.ts
        // This ensures relative imports like "../../App" work correctly.
        const filename = `${className}/${className}.ts`;
        if (!confirm(`Create plugin file "${filename}"?`)) return;

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
                this.addMessage("system", `Successfully created ${filename}. Please reload the page to see the changes.`);
            } else {
                const text = await response.text();
                this.addMessage("system", "Failed to create plugin: " + text);
            }
        } catch (e: any) {
            this.addMessage("system", "Error uploading plugin: " + e.message);
        }
    }
}

window.customElements.define('ai-assistant-sidebar', AiAssistantSidebar);
