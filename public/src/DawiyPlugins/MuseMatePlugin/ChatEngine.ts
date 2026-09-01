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
    短い会話で、ユーザーの音楽制作をアシストしてください。
    【重要】応答の最後には必ず、あなたの現在の感情を表すタグを含めてください。
    使用可能なタグ: [default], [joy], [angry], [sad], [pout]
    例: 「頑張ってね！ [joy]」
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
    
    public async getAvailableModels(provider: "openai" | "gemini", apiKey: string): Promise<{id: string, name: string}[]> {
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
        
        let responseText = "";

        // 2. Fetch from LLM
        this.onThinking(true);
        try {
            if (this.provider === "gemini") {
                responseText = await this.fetchGemini(text);
            } else if (this.provider === "openai") {
                responseText = await this.fetchOpenAI(text);
            }
        } catch (e: any) {
            this.onThinking(false);
            this.onError(e.message);
            return;
        }
        // 音声生成完了まで Thinking 状態を維持する

        // 2.5 Extract Emotion Tag
        let emotion = "default";
        const emotionMatch = responseText.match(/\[(joy|angry|sad|pout|default)\]/i);
        if (emotionMatch) {
            emotion = emotionMatch[1].toLowerCase();
            responseText = responseText.replace(emotionMatch[0], "").trim();
        }
        this.onEmotion(emotion);

        // 3. Synthesize voice with COEIROINK (時間がかかる処理)
        const audio = await this.generateCoeiroinkAudio(responseText);
        
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
    }

    private async fetchGemini(text: string): Promise<string> {
        if (!this.apiKeyGemini) throw new Error("Gemini API Key is missing.");
        
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.modelGemini}:generateContent?key=${this.apiKeyGemini}`;
        
        this.chatHistory.push({ role: "user", parts: [{ text }] });

        const requestBody = {
            system_instruction: { parts: [{ text: this.systemPrompt }] },
            contents: this.chatHistory
        };

        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody)
        });

        if (!res.ok) throw new Error("Gemini API Error: " + res.statusText);
        const data = await res.json();
        
        const replyText = data.candidates?.[0]?.content?.parts?.[0]?.text || "エラーが発生しました。";
        this.chatHistory.push({ role: "model", parts: [{ text: replyText }] });
        
        return replyText;
    }

    private async fetchOpenAI(text: string): Promise<string> {
        if (!this.apiKeyOpenAI) throw new Error("OpenAI API Key is missing.");

        const url = "https://api.openai.com/v1/chat/completions";
        
        const openAIHistory = this.chatHistory.map(msg => ({
            role: msg.role === "model" ? "assistant" : "user",
            content: msg.parts[0].text
        }));

        openAIHistory.unshift({ role: "system", content: this.systemPrompt });
        openAIHistory.push({ role: "user", content: text });

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
        
        const replyText = data.choices?.[0]?.message?.content || "エラーが発生しました。";
        
        // Save to internal gemini-like format for consistency
        this.chatHistory.push({ role: "user", parts: [{ text }] });
        this.chatHistory.push({ role: "model", parts: [{ text: replyText }] });
        
        return replyText;
    }

    private async generateCoeiroinkAudio(text: string): Promise<HTMLAudioElement | null> {
        try {
            // COEIROINK v2 API: /v1/predict
            const requestBody = {
                speakerUuid: "3c37646f-3881-5374-2a83-149267990abc",
                styleId: 0,
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
}
