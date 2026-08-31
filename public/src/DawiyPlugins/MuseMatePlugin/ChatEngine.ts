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

    private systemPrompt = `あなたは「緒守付 にちよ（おもづく にちよ）」という名前の女の子です。
    DAW（音楽制作ソフト）で作業するユーザーを応援し、モチベーションを高めるのがあなたの役割です。
    親しみやすく、少し甘えん坊で、たまにイタズラ好きな性格です。
    短い会話で、ユーザーの音楽制作をアシストしてください。
`;

    constructor(
        onMessageReceived: (message: string, isUser: boolean) => void,
        onVoiceStarted: () => void,
        onVoiceEnded: () => void,
        onError: (error: string) => void
    ) {
        this.onMessageReceived = onMessageReceived;
        this.onVoiceStarted = onVoiceStarted;
        this.onVoiceEnded = onVoiceEnded;
        this.onError = onError;

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
        try {
            if (this.provider === "gemini") {
                responseText = await this.fetchGemini(text);
            } else if (this.provider === "openai") {
                responseText = await this.fetchOpenAI(text);
            }
        } catch (e: any) {
            this.onError(e.message);
            return;
        }

        // 3. Add Bot message to UI
        this.onMessageReceived(responseText, false);

        // 4. Synthesize voice with COEIROINK
        await this.speakWithCoeiroink(responseText);
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

    private async speakWithCoeiroink(text: string) {
        try {
            // 1. Text to Audio Query
            const queryRes = await fetch(`${this.coeiroinkUrl}/v1/audio_query?text=${encodeURIComponent(text)}&speakerUuid=3c37646f-3881-5374-2a83-149267990abc`, {
                method: 'POST'
            });
            if (!queryRes.ok) throw new Error("COEIROINK Audio Query Error");
            const queryData = await queryRes.json();

            // 2. Synthesis
            const synthRes = await fetch(`${this.coeiroinkUrl}/v1/synthesis?speakerUuid=3c37646f-3881-5374-2a83-149267990abc`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(queryData)
            });
            if (!synthRes.ok) throw new Error("COEIROINK Synthesis Error");
            
            const audioBlob = await synthRes.blob();
            const audioUrl = URL.createObjectURL(audioBlob);
            const audio = new Audio(audioUrl);
            
            this.onVoiceStarted();
            audio.onended = () => {
                URL.revokeObjectURL(audioUrl);
                this.onVoiceEnded();
            };
            audio.play();

        } catch (e) {
            console.warn("[Muse Mate] COEIROINK Error. Make sure COEIROINK V2 is running locally on port 50032.", e);
            // Fallback to browser TTS if COEIROINK is not available (optional)
            // this.speakWithBrowserTTS(text);
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
