// @ts-ignore
import NichiyoImg from "./にちよ-デフォルト.png";
// @ts-ignore
import imgDefaultOpen from "./にちよ-口を開いている.png";
// @ts-ignore
import imgSmile from "./にちよ-笑顔.png";
// @ts-ignore
import imgSmileOpen from "./にちよ-笑顔-口を開いている.png";
// @ts-ignore
import imgAngry from "./にちよ-怒った顔.png";
// @ts-ignore
import imgAngryOpen from "./にちよ-怒った顔-口を開いている.png";
// @ts-ignore
import imgSad from "./にちよ-悲しい顔.png";
// @ts-ignore
import imgSadOpen from "./にちよ-悲しい顔-口を開いている.png";
// @ts-ignore
import imgPout from "./にちよ-むすっとしている.png";
// @ts-ignore
import imgThink from "./にちよ-思考.png";
// @ts-ignore
import imgBlink from "./にちよ-まばたき.png";

export type Emotion = "default" | "joy" | "angry" | "sad" | "pout";

export class CharacterUI {
    private characterElement: HTMLDivElement;
    private imgElement: HTMLImageElement;
    private containerElement: HTMLElement | null = null;
    private isRoaming: boolean = false;
    
    // Animation States
    private currentEmotion: Emotion = "default";
    private isTalking: boolean = false;
    private isThinking: boolean = false;
    private isMouthOpen: boolean = false;
    
    // Intervals
    private blinkIntervalId: any = null;
    private lipSyncIntervalId: any = null;

    constructor() {
        this.characterElement = document.createElement("div");
        this.characterElement.className = "mm-character-placeholder";

        this.imgElement = document.createElement("img");
        this.imgElement.src = NichiyoImg;
        this.characterElement.appendChild(this.imgElement);

        this.startBlinking();

        // Add click listener to trigger breakout/roam mode
        this.characterElement.addEventListener("click", () => {
            this.toggleRoamMode();
        });
    }

    public attachTo(container: HTMLElement) {
        this.containerElement = container;
        if (!this.isRoaming) {
            this.containerElement.appendChild(this.characterElement);
        }
    }

    public detach() {
        if (this.characterElement.parentElement) {
            this.characterElement.parentElement.removeChild(this.characterElement);
        }
    }

    public setTalking(talking: boolean) {
        this.isTalking = talking;
        if (talking) {
            this.characterElement.style.animation = "mm-breathe 0.5s infinite ease-in-out alternate";
            this.startLipSync();
        } else {
            this.characterElement.style.animation = "mm-breathe 4s infinite ease-in-out";
            this.stopLipSync();
            this.isMouthOpen = false;
        }
        this.updateImage();
    }

    public setEmotion(emotion: string) {
        if (["default", "joy", "angry", "sad", "pout"].includes(emotion)) {
            this.currentEmotion = emotion as Emotion;
            this.updateImage();
        }
    }

    public setThinking(thinking: boolean) {
        this.isThinking = thinking;
        this.updateImage();
    }

    private startBlinking() {
        const scheduleNextBlink = () => {
            const delay = 3000 + Math.random() * 3000;
            this.blinkIntervalId = setTimeout(() => {
                if (!this.isTalking && !this.isThinking && this.currentEmotion === "default") {
                    this.imgElement.src = imgBlink;
                    setTimeout(() => {
                        this.updateImage();
                        scheduleNextBlink();
                    }, 150);
                } else {
                    scheduleNextBlink();
                }
            }, delay);
        };
        scheduleNextBlink();
    }

    private startLipSync() {
        if (this.lipSyncIntervalId) return;
        this.lipSyncIntervalId = setInterval(() => {
            this.isMouthOpen = !this.isMouthOpen;
            this.updateImage();
        }, 150);
    }
    
    private stopLipSync() {
        if (this.lipSyncIntervalId) {
            clearInterval(this.lipSyncIntervalId);
            this.lipSyncIntervalId = null;
        }
    }

    private updateImage() {
        if (this.isThinking) {
            this.imgElement.src = imgThink;
            return;
        }
        
        switch (this.currentEmotion) {
            case "joy":
                this.imgElement.src = this.isMouthOpen ? imgSmileOpen : imgSmile;
                break;
            case "angry":
                this.imgElement.src = this.isMouthOpen ? imgAngryOpen : imgAngry;
                break;
            case "sad":
                this.imgElement.src = this.isMouthOpen ? imgSadOpen : imgSad;
                break;
            case "pout":
                this.imgElement.src = imgPout; // No open mouth variant
                break;
            case "default":
            default:
                this.imgElement.src = this.isMouthOpen ? imgDefaultOpen : NichiyoImg;
                break;
        }
    }

    private toggleRoamMode() {
        this.isRoaming = !this.isRoaming;

        this.detach();

        if (this.isRoaming) {
            // Breakout mode: append to body
            this.characterElement.classList.add("mm-character-roam");
            document.body.appendChild(this.characterElement);
            this.startRoaming();
        } else {
            // Return to sidebar
            this.characterElement.classList.remove("mm-character-roam");
            this.characterElement.style.transform = "";
            this.characterElement.style.translate = "";
            this.characterElement.style.left = "";
            this.characterElement.style.top = "";
            this.characterElement.style.bottom = "";
            this.characterElement.style.right = "";

            if (this.containerElement) {
                this.containerElement.appendChild(this.characterElement);
            }
            this.stopRoaming();
        }
    }

    private startRoaming() {
        // 画像サイズ
        const charWidth = 300;
        const charHeight = 450;
        
        // DAWのUI（左のトラックリスト、右のプラグイン、上のトランスポート等）を避けるためのバウンディングボックス
        const minX = 350; // 左側
        const maxX = Math.max(minX, window.innerWidth - 350 - charWidth); // 右側
        
        const minY = 100; // 上部
        const maxY = Math.max(minY, window.innerHeight - 100 - charHeight); // 下部
        
        // ランダムな位置を計算
        let x = minX + Math.random() * (maxX - minX);
        let y = minY + Math.random() * (maxY - minY);

        // CSSでの位置指定をリセット
        this.characterElement.style.left = "0px";
        this.characterElement.style.top = "0px";
        this.characterElement.style.bottom = "auto";
        this.characterElement.style.right = "auto";
        this.characterElement.style.transform = "";

        // 移動アニメーションを無くし、計算した位置に固定
        this.characterElement.style.translate = `${x}px ${y}px`;
    }

    private stopRoaming() {
        // setIntervalは使わなくなったため、特にクリーンアップ処理は不要です
    }
}
