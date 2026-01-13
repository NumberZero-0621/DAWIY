import App from "../App";
import { IDawiyPlugin } from "./IDawiyPlugin";
import { getRandomColor } from "../Utils/Color";

export default class TrackUtilityPlugin implements IDawiyPlugin {
    id = "track-utility";
    name = "Track Utils";
    description = "Batch utilities for track management (Mixer Reset, Colors, Naming).";

    private app: App;

    constructor(app: App) {
        this.app = app;
    }

    public render(container: HTMLElement) {
        container.innerHTML = '';
        container.style.color = "#eee";
        container.style.padding = "10px";
        container.style.display = "flex";
        container.style.flexDirection = "column";
        container.style.gap = "10px";

        const title = document.createElement("h3");
        title.textContent = this.name;
        title.style.margin = "0 0 10px 0";
        container.appendChild(title);

        this.createButton(container, "Randomize Colors", () => this.randomizeColors());
        this.createButton(container, "Reset Mixer (Vol/Pan)", () => this.resetMixer());
        this.createButton(container, "Auto-Name Tracks", () => this.autoNameTracks());

        const muteGroup = document.createElement("div");
        muteGroup.style.display = "flex";
        muteGroup.style.gap = "5px";
        this.createButton(muteGroup, "Mute All", () => this.setAllMute(true));
        this.createButton(muteGroup, "Unmute All", () => this.setAllMute(false));
        container.appendChild(muteGroup);
    }

    private createButton(parent: HTMLElement, text: string, onClick: () => void) {
        const btn = document.createElement("button");
        btn.textContent = text;
        btn.style.padding = "8px";
        btn.style.background = "#555";
        btn.style.color = "white";
        btn.style.border = "1px solid #777";
        btn.style.borderRadius = "4px";
        btn.style.cursor = "pointer";
        btn.onclick = onClick;
        parent.appendChild(btn);
    }

    private randomizeColors() {
        const tracks = this.app.tracksController.tracks;
        const oldColors = tracks.map(t => ({ track: t, color: t.color }));

        this.app.doIt(true,
            () => {
                tracks.forEach(t => this.app.tracksController.setColor(t, getRandomColor()));
            },
            () => {
                oldColors.forEach(item => this.app.tracksController.setColor(item.track, item.color));
            }
        );
    }

    private resetMixer() {
        const tracks = this.app.tracksController.tracks;
        const oldState = tracks.map(t => ({ track: t, vol: t.volume, pan: t.balance }));

        this.app.doIt(true,
            () => {
                tracks.forEach(t => {
                    t.volume = 1.0; // Unity gain? Or 0.5? Let's use 0.75 as a safe default or 1.0. 
                    // TracksController uses 0.5 as oldVolume default.
                    // track.element.volume max is 100.
                    // Let's set to 0.8 (approx -2dB) or just 1.0.
                    // Usually reset means 0dB.
                    t.element.volume = 100;
                    t.volume = 1.0;

                    t.element.balance = 0;
                    t.balance = 0;
                });
            },
            () => {
                oldState.forEach(s => {
                    s.track.volume = s.vol;
                    s.track.element.volume = s.vol * 100;
                    s.track.balance = s.pan;
                    s.track.element.balance = s.pan;
                });
            }
        );
    }

    private autoNameTracks() {
        const tracks = this.app.tracksController.tracks;
        const oldNames = tracks.map(t => ({ track: t, name: t.element.name }));

        this.app.doIt(true,
            () => {
                tracks.forEach((t, i) => {
                    t.element.name = `Track ${i + 1}`;
                });
            },
            () => {
                oldNames.forEach(s => {
                    s.track.element.name = s.name;
                });
            }
        );
    }

    private setAllMute(mute: boolean) {
        const tracks = this.app.tracksController.tracks;
        const oldMutes = tracks.map(t => ({ track: t, muted: t.isMuted }));

        this.app.doIt(true,
            () => {
                tracks.forEach(t => t.isMuted = mute);
            },
            () => {
                oldMutes.forEach(s => {
                    s.track.isMuted = s.muted;
                });
            }
        );
    }
}
