import { WamNode } from "@webaudiomodules/api";
import { RATIO_MILLS_BY_PX } from "../../Env";
import Region, { RegionOf, RegionType } from "./Region";
import RegionPlayer from "./RegionPlayer";

/**
 * カーブモード定義
 * Linear: 直線（デフォルト）
 * Step: ジャンプ（水平線→垂直ジャンプ）
 * Fast: ファーストカーブ（最初に急変化、後半ゆるやか）
 * Slow: スローカーブ（最初ゆるやか、後半に急変化）
 */
export enum CurveMode {
    Linear = 0,
    Step = 1,
    Fast = 2,
    Slow = 3
}

/**
 * curve は「このポイントから次のポイントへ」の線のモードを表す
 */
export type AutomationPoint = { time: number, value: number, curve: CurveMode };

export default class AutomationRegion extends RegionOf<AutomationRegion> {

    static readonly TYPE = "AUTOMATION_REGION";

    /**
     * The ID of the parameter that this automation controls.
     */
    public paramId: string = "";

    /**
     * Custom color for this automation lane.
     * If null, follows the track color.
     */
    public color: string | null = null;

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
        const newPoints = this.points.map(p => ({ ...p })); // Still copying points here, could share for true non-destructive if points don't change
        const r = new AutomationRegion(this.start, this.duration, newPoints);
        r.paramId = this.paramId;
        r.color = this.color;
        r.offset = this.offset;
        return r;
    }

    emptyAlike(start: number, duration: number): AutomationRegion {
        return new AutomationRegion(start, duration);
    }

    split(cut: number): [AutomationRegion, AutomationRegion] {
        const r1 = this.clone();
        r1.duration = cut;

        const r2 = this.clone();
        r2.start = this.start + cut;
        r2.offset = this.offset + cut;
        r2.duration = Math.max(0, this.duration - cut);

        return [r1, r2];
    }

    mergeWith(other: AutomationRegion): void {
        // In a non-destructive paradigm, mergeWith for simple trimming isn't typically used.
        // Or if they do, we concat points? (Not implementing complex point merging for simple trims)
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
