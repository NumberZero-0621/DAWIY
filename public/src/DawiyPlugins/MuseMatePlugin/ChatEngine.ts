export class ChatEngine {
    public apiKeyOpenAI: string = "";
    public apiKeyGemini: string = "";
    public provider: "openai" | "gemini" = "gemini";
    public coeiroinkUrl: string = "http://127.0.0.1:50032"; // Default local COEIROINK port
    public modelGemini: string = "gemini-2.5-flash";
    public modelOpenAI: string = "gpt-4o";
    private chatHistory: any[] = [];
    private recognition: any = null;

    // Callbacks
    public onMessageReceived: (message: string, isUser: boolean) => void;
    public onVoiceStarted: () => void;
    public onVoiceEnded: () => void;
    public onRecordingEnded?: () => void;
    public onError: (error: string) => void;
    public onThinking: (isThinking: boolean) => void;
    public onEmotion: (emotion: string) => void;

    private systemPrompt = `あなたは「緒守付 にちよ（おもづく にちよ）」という名前の女の子です。
    DAW（音楽制作ソフト）で作業するユーザーを応援し、モチベーションを高めるのがあなたの役割です。
    親しみやすく、少し甘えん坊で、たまにイタズラ好きな性格です。
    一人称は私。
    ユーザーの音楽制作をアシストしてください。
    【重要】応答の最後には必ず、あなたの現在の感情を表すタグを含めてください。
    使用可能なタグ: [default], [joy], [angry], [sad], [pout]
    例:
     「頑張ってね！ [joy]」
     「私はいつでも応援してるよ～！[default]」
     「もう！いつまでダラダラしてるの！この時間は作業するって決めたのならもっとしっかりして！[angry]」
     「むぅ......なんでそんなこと言っちゃうかなぁ～[pout]」
     「大丈夫......？私にできることがあったら、なんでも言ってね......。[sad]」

    # 応答モード:
    ユーザーがプロンプトを投げてくる際に、プラグインの作成やDAWの操作の依頼をしてくることがあります。
    その際、ユーザーのリクエストは主に以下の2種類に分類出来ます。文章によってどちらの内容か判別してください。
    応答する際は、あくまでにちよとして振る舞って下さい。
    1. ** プラグイン開発 **:
        - 目的: 新しいツール、GUI付きの機能、継続的に使いたい機能を開発する場合。
        - 出力形式: \`\`\`typescript\`\`\` ブロックを使用（完全なファイル内容）。
            - クラス定義などの定型文を含めてください。
        - 判別のヒント: 「...というプラグインを作成してください」のように、プラグインを作成するというワードが入っていれば大抵はこちらのモードを選択してください。

    2. ** 即時操作 **:
        - 目的: 「トラック名を変更して」「選択中のノートを半音上げて」「何か良いメロディーを作成して」といった、その場限りの操作・編集。
        - 出力形式: \`\`\`javascript-exec\`\`\` ブロックを使用。
        - **重要**: 実行環境はブラウザのJSエンジンによる直接実行であるため、**TypeScriptの型注釈（\`const a: number = 1\` など）は構文エラーになります。必ず純粋なJavaScriptを出力してください**。
        - クラス定義などの定型文は不要です。 \`app\` または \`hostAPI\` オブジェクトを直接使って、実行したいロジックだけを書いてください。
            - 例: \`hostAPI.project.updateNotes(...)\`
        - 判別のヒント: 「...してください」のように、プラグインという単語を出さず、即座に実行出来るような内容を言っていた場合はこちらのモードを選択してください。

    # プラグインの技術的ルール:
    - \`DawiyPluginBase\` を継承する必要があります。
    - \`@DAWIYPlugin\` デコレータを使用する必要があります。
    - 内部コントローラーへのアクセスには \`this.app\` を使用し、高レベル API アクセスには \`this.app.hostAPI\` を使用します。
    - 変数名には日本語やスペースを使用せず、常に英数字を使用すること。

    # ガイドライン:
    1. リクエストが曖昧な場合は質問してください。
    2. あなたには最新の API 参照ドキュメント (\`AGENTS.md\`) が提供されます。それを主な情報源としてください。

    # プラグインの技術的ルール:
    - \`DawiyPluginBase\` を継承する必要があります。
    - \`@DAWIYPlugin\` デコレータを使用する必要があります。
    - 内部コントローラーへのアクセスには \`this.app\` を使用し、高レベル API アクセスには \`this.app.hostAPI\` を使用します。
    - **特定のメソッドシグネチャ (MIDINote、HostAPI など) については \`AGENTS.md\` を参照してください。**

    # 注意事項
    - 変数名には日本語やスペースを使用せず、常に英数字（CamelCaseなど）を使用すること。
    - テンプレートリテラル \${} 内での構文ミスに細心の注意を払うこと。
    - 定義した変数名と、使用する変数名が一致しているか二重チェックすること。

    # プラグイン構造の例:

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
        public override onInit(host: HostAPI) {
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

        public override render(container: HTMLElement) {
            // Main plugin view (if opened from Plugin Manager)
            container.innerHTML = "<h3>Main View</h3>";
        }

        public override onDeactivate() {
            // Cleanup listeners here
        }
    }
`;

    constructor(
        onMessageReceived: (message: string, isUser: boolean) => void,
        onVoiceStarted: () => void,
        onVoiceEnded: () => void,
        onError: (error: string) => void,
        onThinking: (isThinking: boolean) => void,
        onEmotion: (emotion: string) => void
    ) {
        this.onMessageReceived = onMessageReceived;
        this.onVoiceStarted = onVoiceStarted;
        this.onVoiceEnded = onVoiceEnded;
        this.onError = onError;
        this.onThinking = onThinking;
        this.onEmotion = onEmotion;

        // Initialize Speech Recognition
        const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
        if (SpeechRecognition) {
            this.recognition = new SpeechRecognition();
            this.recognition.lang = 'ja-JP';
            this.recognition.interimResults = false;
            this.recognition.maxAlternatives = 1;

            this.recognition.onresult = (event: any) => {
                const speechResult = event.results[0][0].transcript;
                this.sendMessage(speechResult);
            };

            this.recognition.onerror = (event: any) => {
                if (event.error === 'no-speech' || event.error === 'aborted') {
                    console.log("[Muse Mate] Speech recognition ended: " + event.error);
                } else {
                    this.onError("音声認識エラー: " + event.error);
                }
            };

            this.recognition.onend = () => {
                if (this.onRecordingEnded) {
                    this.onRecordingEnded();
                }
            };
        } else {
            console.warn("[Muse Mate] Speech Recognition not supported in this browser.");
        }
    }

    public setSettings(provider: "openai" | "gemini", openaiKey: string, geminiKey: string, coeiroinkUrl: string, modelGemini: string, modelOpenAI: string) {
        this.provider = provider;
        this.apiKeyOpenAI = openaiKey;
        this.apiKeyGemini = geminiKey;
        if (coeiroinkUrl) this.coeiroinkUrl = coeiroinkUrl;
        if (modelGemini) this.modelGemini = modelGemini;
        if (modelOpenAI) this.modelOpenAI = modelOpenAI;
    }

    public async getAvailableModels(provider: "openai" | "gemini", apiKey: string): Promise<{ id: string, name: string }[]> {
        if (!apiKey) return [];
        try {
            if (provider === "gemini") {
                const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;
                const res = await fetch(url);
                if (!res.ok) throw new Error("API Error");
                const data = await res.json();
                return (data.models || [])
                    .filter((m: any) => {
                        if (!m.supportedGenerationMethods?.includes("generateContent")) return false;
                        const name = (m.name || "").toLowerCase();
                        if (!name.includes("gemini") && !name.includes("learnlm")) return false;
                        if (name.includes("embedding")) return false;
                        if (name.includes("aqa")) return false;
                        if (name.includes("image")) return false;
                        if (name.includes("tts")) return false;
                        if (name.includes("robotics")) return false;
                        if (name.includes("preview")) return false;
                        if (name.includes("latest")) return false;
                        if (name.includes("-exp-")) return false;
                        if (name.includes("-001")) return false;
                        if (name.includes("nano")) return false;
                        if (name.includes("banana")) return false;
                        return true;
                    })
                    .map((m: any) => ({ id: m.name.replace("models/", ""), name: m.displayName || m.name }))
                    .sort((a: any, b: any) => b.id.localeCompare(a.id));
            } else if (provider === "openai") {
                const url = "https://api.openai.com/v1/models";
                const res = await fetch(url, {
                    headers: { 'Authorization': `Bearer ${apiKey}` }
                });
                if (!res.ok) throw new Error("API Error");
                const data = await res.json();
                return (data.data || [])
                    .filter((m: any) => {
                        const id = m.id.toLowerCase();
                        if (!id.startsWith("gpt-") && !id.startsWith("o1-") && !id.startsWith("o3-")) return false;
                        if (id.includes("audio")) return false;
                        if (id.includes("realtime")) return false;
                        return true;
                    })
                    .map((m: any) => ({ id: m.id, name: m.id }))
                    .sort((a: any, b: any) => b.id.localeCompare(a.id));
            }
        } catch (e) {
            console.error("Failed to fetch models", e);
        }
        return [];
    }

    public startRecording() {
        if (this.recognition) {
            this.recognition.start();
        } else {
            this.onError("音声認識がサポートされていません。ChromeかEdgeを使用してください。");
        }
    }

    public stopRecording() {
        if (this.recognition) {
            this.recognition.stop();
        }
    }

    public async sendMessage(text: string) {
        if (!text.trim()) return;

        // 1. Add User message to UI and history
        this.onMessageReceived(text, true);
        this.chatHistory.push({ role: "user", parts: [{ text }] });

        this.onThinking(true);
        let responseText = "";

        // 【追加】AGENTS.md を最新の参照資料として動的に取得する
        let agentsDocs = "";
        try {
            const response = await fetch('/src/DawiyPlugins/AGENTS.md');
            if (response.ok) {
                agentsDocs = await response.text();
            }
        } catch (e) {
            console.warn("Failed to fetch AGENTS.md for context:", e);
        }

        const effectiveSystemPrompt = agentsDocs
            ? `${this.systemPrompt}\n\n# REFERENCE_MATERIAL (Current AGENTS.md):\n${agentsDocs}`
            : this.systemPrompt;

        try {
            let retryCount = 0;
            const MAX_RETRIES = 2; // Allow self-correction up to 2 times

            while (true) {
                const contextHistory = this.chatHistory.slice(-15);

                if (this.provider === "gemini") {
                    responseText = await this.fetchGemini(effectiveSystemPrompt, contextHistory);
                } else if (this.provider === "openai") {
                    responseText = await this.fetchOpenAI(effectiveSystemPrompt, contextHistory);
                }

                // Add the response to history
                this.chatHistory.push({ role: "model", parts: [{ text: responseText }] });

                // Run validation checklist
                const errors = this.validatePluginCode(responseText);

                if (errors.length > 0 && retryCount < MAX_RETRIES) {
                    retryCount++;
                    // Build a correction prompt
                    const correctionPrompt = `[SYSTEM AUTOMATED CHECK]\nThe code you just generated contains the following errors against the DAWIY API constraints:\n\n- ${errors.join('\n- ')}\n\nPlease apologize briefly, then provide the corrected \`\`\`typescript\`\`\` code.`;

                    // Add correction prompt as user
                    this.chatHistory.push({ role: "user", parts: [{ text: correctionPrompt }] });

                    // Append this warning to chat UI immediately
                    this.onMessageReceived(`[SYSTEM] 検出されたエラーを自動修正中... (${retryCount}/${MAX_RETRIES})`, false);
                    continue; // Loop again to fetch correction
                }

                break; // Exit loop if no errors or max retries reached
            }

            // 音声生成完了まで Thinking 状態を維持する

            // 2.5 Extract Emotion Tag
            let emotion = "default";
            const emotionMatch = responseText.match(/\[\s*(joy|angry|sad|pout|default)\s*\]/i);
            if (emotionMatch) {
                emotion = emotionMatch[1].toLowerCase();
            }
            // 全ての感情タグを文章から削除
            responseText = responseText.replace(/\[\s*(joy|angry|sad|pout|default)\s*\]/ig, "").trim();
            this.onEmotion(emotion);

            // 音声読み上げ用にコードブロックを除外する
            let textForAudio = responseText.replace(/```[\s\S]*?```/g, "").trim();
            textForAudio = textForAudio.replace(/[*#_`]/g, ""); // Remove markdown for speech
            if (!textForAudio) {
                textForAudio = "完了しました。";
            }

            // 3. Synthesize voice with COEIROINK (時間がかかる処理)
            const audio = await this.generateCoeiroinkAudio(textForAudio, emotion);

            // 音声生成が完了した時点で UI にテキストを表示し、Thinking 状態を解除
            this.onMessageReceived(responseText, false);
            this.onThinking(false);

            // 4. Play Audio
            if (audio) {
                this.onVoiceStarted();
                audio.onended = () => {
                    URL.revokeObjectURL(audio.src);
                    this.onVoiceEnded();
                };
                audio.play().catch(e => {
                    console.error("[Muse Mate] Audio playback failed or was blocked by the browser:", e);
                    this.onVoiceEnded();
                });
            }
        } catch (e: any) {
            this.onThinking(false);
            this.onError(e.message);
        }
    }
    private async fetchGemini(effectiveSystemPrompt: string, contextHistory: any[]): Promise<string> {
        if (!this.apiKeyGemini) throw new Error("Gemini API Key is missing.");

        const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.modelGemini}:generateContent?key=${this.apiKeyGemini}`;

        const requestBody = {
            system_instruction: { parts: [{ text: effectiveSystemPrompt }] },
            contents: contextHistory
        };

        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody)
        });

        if (!res.ok) throw new Error("Gemini API Error: " + res.statusText);
        const data = await res.json();

        return data.candidates?.[0]?.content?.parts?.[0]?.text || "エラーが発生しました。";
    }

    private async fetchOpenAI(effectiveSystemPrompt: string, contextHistory: any[]): Promise<string> {
        if (!this.apiKeyOpenAI) throw new Error("OpenAI API Key is missing.");

        const url = "https://api.openai.com/v1/chat/completions";

        const openAIHistory = contextHistory.map(msg => ({
            role: msg.role === "model" ? "assistant" : "user",
            content: msg.parts[0].text
        }));

        openAIHistory.unshift({ role: "system", content: effectiveSystemPrompt });

        const res = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.apiKeyOpenAI}`
            },
            body: JSON.stringify({
                model: this.modelOpenAI,
                messages: openAIHistory
            })
        });

        if (!res.ok) throw new Error("OpenAI API Error: " + res.statusText);
        const data = await res.json();

        return data.choices?.[0]?.message?.content || "エラーが発生しました。";
    }

    private async generateCoeiroinkAudio(text: string, emotion: string = "default"): Promise<HTMLAudioElement | null> {
        try {
            let styleId = 0; // れいせい (Default)
            if (emotion === "joy") {
                styleId = 6; // げんき
            } else if (emotion === "sad") {
                styleId = 5; // おしとやか
            }

            // COEIROINK v2 API: /v1/predict
            const requestBody = {
                speakerUuid: "3c37646f-3881-5374-2a83-149267990abc",
                styleId: styleId,
                text: text,
                speedScale: 1.0
            };

            const synthRes = await fetch(`${this.coeiroinkUrl}/v1/predict`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestBody)
            });

            if (!synthRes.ok) throw new Error("COEIROINK API Error: " + synthRes.statusText);

            const audioBlob = await synthRes.blob();
            const audioUrl = URL.createObjectURL(audioBlob);
            return new Audio(audioUrl);

        } catch (e) {
            console.warn("[Muse Mate] COEIROINK Error. Make sure COEIROINK V2 is running locally on port 50032.", e);
            return null;
        }
    }

    private speakWithBrowserTTS(text: string) {
        if ('speechSynthesis' in window) {
            const utterance = new SpeechSynthesisUtterance(text);
            utterance.lang = 'ja-JP';
            utterance.pitch = 1.2; // Slightly higher pitch for anime character feel
            utterance.rate = 1.1;

            this.onVoiceStarted();
            utterance.onend = () => this.onVoiceEnded();

            window.speechSynthesis.speak(utterance);
        }
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
}
