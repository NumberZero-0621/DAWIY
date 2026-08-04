import { AutomationPoint } from "../Models/Region/AutomationRegion";

/**
 * Utility to map time (ms) to project pixels (X) based on a variable BPM automation map.
 */
export default class TempoMap {
    private _points: AutomationPoint[];
    private _baseBpm: number;
    private _pixelsPerBeat: number;
    private _denormalizeBpm: (v: number) => number;

    constructor(points: AutomationPoint[], baseBpm: number, pixelsPerBeat: number, denormalizeBpm: (v: number) => number) {
        this._points = [...points].sort((a, b) => a.time - b.time);
        this._baseBpm = baseBpm;
        this._pixelsPerBeat = pixelsPerBeat;
        this._denormalizeBpm = denormalizeBpm;
    }

    /**
     * Converts time in milliseconds to pixel X coordinate using tempo integration.
     */
    public timeToX(timeMs: number): number {
        if (this._points.length === 0) {
            return (timeMs / 60000) * this._baseBpm * this._pixelsPerBeat;
        }

        let totalBeats = 0;
        let currentTime = 0;

        for (let i = 0; i < this._points.length; i++) {
            const p = this._points[i];
            if (p.time > timeMs) break;

            const duration = p.time - currentTime;
            const avgBpm = this.getAverageBpmBetween(currentTime, p.time);
            totalBeats += (duration / 60000) * avgBpm;
            
            currentTime = p.time;
        }

        const remainingDuration = timeMs - currentTime;
        if (remainingDuration > 0) {
            const avgBpm = this.getAverageBpmBetween(currentTime, timeMs);
            totalBeats += (remainingDuration / 60000) * avgBpm;
        }

        return totalBeats * this._pixelsPerBeat;
    }

    /**
     * Estimates average BPM in a given time interval [t1, t2] using the automation curve.
     */
    public getAverageBpmBetween(t1: number, t2: number): number {
        if (t1 >= t2) return this.getBpmAt(t1);
        
        // Simple 2-point average for now. For better accuracy, we could subdivide.
        // If there are points INSIDE [t1, t2], we should integrate piece-wise.
        const internalPoints = this._points.filter(p => p.time > t1 && p.time < t2);
        if (internalPoints.length === 0) {
            return (this.getBpmAt(t1) + this.getBpmAt(t2)) / 2;
        }

        let integratedBeats = 0;
        let current = t1;
        for (const p of internalPoints) {
            integratedBeats += ((p.time - current) / 60000) * (this.getBpmAt(current) + this.getBpmAt(p.time)) / 2;
            current = p.time;
        }
        integratedBeats += ((t2 - current) / 60000) * (this.getBpmAt(current) + this.getBpmAt(t2)) / 2;

        return (integratedBeats * 60000) / (t2 - t1);
    }

    public getBpmAt(timeMs: number): number {
        if (this._points.length === 0) return this._baseBpm;
        
        const nextIdx = this._points.findIndex(p => p.time > timeMs);
        if (nextIdx === -1) return this._denormalizeBpm(this._points[this._points.length - 1].value);
        if (nextIdx === 0) return this._denormalizeBpm(this._points[0].value);

        const prev = this._points[nextIdx - 1];
        const next = this._points[nextIdx];
        const t = (timeMs - prev.time) / (next.time - prev.time);
        
        const val = prev.value * (1 - t) + next.value * t;
        return this._denormalizeBpm(val);
    }

    /**
     * Converts pixel X coordinate back to time in milliseconds using binary search.
     */
    public xToMs(x: number): number {
        let low = 0;
        let high = 60000 * 60; // Max 60 minutes for safety
        let mid = 0;

        // Perform binary search to find time t such that timeToX(t) ≈ x
        for (let i = 0; i < 32; i++) { // 32 iterations for high precision
            mid = (low + high) / 2;
            if (this.timeToX(mid) < x) {
                low = mid;
            } else {
                high = mid;
            }
        }
        return mid;
    }
}
