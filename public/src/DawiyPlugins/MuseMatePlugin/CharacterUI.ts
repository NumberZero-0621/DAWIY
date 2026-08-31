export class CharacterUI {
    private characterElement: HTMLDivElement;
    private containerElement: HTMLElement | null = null;
    private isRoaming: boolean = false;
    private roamInterval: any = null;

    constructor() {
        this.characterElement = document.createElement("div");
        this.characterElement.className = "mm-character-placeholder";
        this.characterElement.innerText = "Nichiyo\n(Live2D here)";
        
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
        if (talking) {
            this.characterElement.style.animation = "mm-breathe 0.5s infinite ease-in-out alternate";
        } else {
            this.characterElement.style.animation = "mm-breathe 4s infinite ease-in-out";
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
        // Very basic wandering logic
        let x = window.innerWidth / 2;
        let y = window.innerHeight / 2;
        let vx = 1;
        let vy = 1;
        
        this.characterElement.style.left = x + "px";
        this.characterElement.style.top = y + "px";
        this.characterElement.style.bottom = "auto";
        this.characterElement.style.right = "auto";
        
        this.roamInterval = setInterval(() => {
            x += vx;
            y += vy;
            
            if (x < 0 || x > window.innerWidth - 150) vx *= -1;
            if (y < 0 || y > window.innerHeight - 200) vy *= -1;
            
            // Random direction changes
            if (Math.random() < 0.05) vx = (Math.random() - 0.5) * 4;
            if (Math.random() < 0.05) vy = (Math.random() - 0.5) * 4;

            this.characterElement.style.transform = `translate(${x}px, ${y}px)`;
        }, 33); // ~30fps
    }

    private stopRoaming() {
        if (this.roamInterval) {
            clearInterval(this.roamInterval);
            this.roamInterval = null;
        }
    }
}
