import { WamNode } from "@webaudiomodules/api";
import { RATIO_MILLS_BY_PX } from "../../Env";
import Region, { RegionOf, RegionType } from "./Region";
import RegionPlayer from "./RegionPlayer";

export type AutomationPoint = { time: number, value: number, curve: number };

export default class AutomationRegion extends RegionOf<AutomationRegion> {

    static readonly TYPE = "AUTOMATION_REGION";

    /**
     * The ID of the parameter that this automation controls.
     */
    public paramId: string = "";

    /**
     * Points of the automation.
     * time: milliseconds relative to region start.
     * value: 0.0 to 1.0 (normalized value)
     * curve: curve factor (optional)
     */
    points: AutomationPoint[] = [];

    /**
     * @param start Start position in milliseconds
     * @param duration Duration in milliseconds
     * @param points Initial points
     */
    constructor(start: number, duration: number, points: AutomationPoint[] = []) {
        super(start);
        this._duration = duration;
        this.points = points;

        if (this.points.length === 0) {
            // Default points: Start and End
            this.points.push({ time: 0, value: 0.5, curve: 0 });
            this.points.push({ time: duration, value: 0.5, curve: 0 });
        }
    }

    private _duration: number;
    get duration(): number { return this._duration; }
    set duration(val: number) { this._duration = val; } // Allow setting for now

    get regionType(): RegionType<AutomationRegion> { return AutomationRegion.TYPE; }

    /**
     * Clone the region.
     */
    clone(): AutomationRegion {
        const newPoints = this.points.map(p => ({ ...p }));
        return new AutomationRegion(this.start, this.duration, newPoints);
    }

    emptyAlike(start: number, duration: number): AutomationRegion {
        return new AutomationRegion(start, duration);
    }

    split(cut: number): [AutomationRegion, AutomationRegion] {
        // Implementation for splitting automation... 
        // For now, simple split logic:
        // region1 gets points < cut
        // region2 gets points >= cut (adjusted by cut offset)
        // Also need to inject point at cut.

        // Simulating simple split for type compatibility.
        // Real implementation might be needed if user splits regions.
        // But AutomationRegion is intended to be track-long.

        const r1 = new AutomationRegion(this.start, cut, []);
        const r2 = new AutomationRegion(this.start + cut, this.duration - cut, []);

        // Distribute points (simple copy for now or todo)
        return [r1, r2];
    }

    mergeWith(other: AutomationRegion): void {
        // Merge points...
        // Assuming user won't merge automation regions mainly.
        // Or if they do, we concat points?
    }

    async createPlayer(groubid: string, audioContext: BaseAudioContext): Promise<RegionPlayer> {
        return new AutomationRegionPlayer();
    }

    save(): Blob {
        // Serialization logic
        const data = JSON.stringify({
            start: this.start,
            duration: this.duration,
            points: this.points
        });
        return new Blob([data], { type: "application/json" });
    }
}

class AutomationRegionPlayer implements RegionPlayer {
    isPlaying: boolean = false;
    playhead: number = 0;
    connect(node: AudioNode): void { }
    disconnect(node: AudioNode): void { }
    connectEvents(node: WamNode): void { }
    disconnectEvents(node: WamNode): void { }
    async playEfficiently(start: number, duration: number): Promise<void> { }
    dispose(): void { }
    setLoop(range: [number, number] | null): void { }
}
