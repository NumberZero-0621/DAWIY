import App from "../App";
import AutomationTrackElement from "../Components/Editor/AutomationTrackElement";
import { MAX_DURATION_SEC } from "../Env";
import AutomationRegion from "../Models/Region/AutomationRegion";
import Track from "../Models/Track/Track";
import AutomationView from "../Views/AutomationView";


export default class AutomationController {

    private _app: App;
    private _view: AutomationView;

    constructor(app: App) {
        this._app = app;
        this._view = this._app.automationView;
        // bindEvents removed as menu is no longer used
    }

    /**
     * Toggles automation visibility.
     * If visible, adds AutomationTrackElement and populates dropdown.
     */
    public async toggleAutomationVisibility(track: Track, visible: boolean) {
        if (track.isAutomationOpened === visible) {
            // Check if UI is consistent (element exists?)
            const existingEl = document.getElementById("automation-track-" + track.id);
            if (visible && !existingEl) {
                // Fallthrough to recreate
            } else {
                return;
            }
        }

        track.isAutomationOpened = visible;

        if (visible) {
            // 1. Ensure AutomationRegion exists
            if (!track.automationRegion) {
                // Default: create new one. ParamId will be set later or default.
                track.automationRegion = new AutomationRegion(0, MAX_DURATION_SEC * 1000);
            }

            // 2. Add AutomationRegion to Editor (if not present)
            if (!track.getRegionById(track.automationRegion.id)) {
                this._app.regionsController.addRegion(track, track.automationRegion);
            }

            // 3. Create and Add AutomationTrackElement (Header)
            let automationTrackElement = document.getElementById("automation-track-" + track.id) as AutomationTrackElement;
            if (!automationTrackElement) {
                automationTrackElement = document.createElement("automation-track-element") as AutomationTrackElement;
                automationTrackElement.id = "automation-track-" + track.id;
                this._app.tracksView.addAutomationTrack(track.element, automationTrackElement);
            }

            // 4. Populate Dropdown parameters
            let plugin = track.plugin;
            let paramList: { id: string, label: string }[] = [];

            // Default "No Selection" or similar? Or just first param?
            // User requirement: "Select to load corresponding data".

            if (plugin?.instance) {
                let params = await plugin.instance._audioNode.getParameterInfo();
                for (let paramId in params) {
                    paramList.push({
                        id: paramId,
                        label: params[paramId].label || paramId
                    });
                }
            }

            // Set current selection
            let currentParamId = track.automationRegion.paramId;
            if (!currentParamId && paramList.length > 0) {
                currentParamId = paramList[0].id;
                track.automationRegion.paramId = currentParamId;
            }

            automationTrackElement.setParameters(paramList, currentParamId);

            // Handle Dropdown Change
            automationTrackElement.onChange = (newParamId) => {
                if (track.automationRegion) {
                    const oldParamId = track.automationRegion.paramId;

                    // 1. Save current points
                    if (oldParamId) {
                        // Store the current array of points into the map
                        track.automationData.set(oldParamId, track.automationRegion.points);
                    }

                    // 2. Load new points
                    let newPoints = track.automationData.get(newParamId);
                    if (!newPoints) {
                        // Create default points if none exist for this param
                        newPoints = [
                            { time: 0, value: 0.5, curve: 0 },
                            { time: track.automationRegion.duration, value: 0.5, curve: 0 }
                        ];
                        // Also store it immediately? Not strictly necessary until we switch away, 
                        // but good for consistency.
                        track.automationData.set(newParamId, newPoints);
                    }

                    // 3. Update Region
                    track.automationRegion.paramId = newParamId;
                    track.automationRegion.points = newPoints;

                    // 4. Redraw
                    const regionView = this._app.editorView.getWaveFormViewById(track.id)?.getRegionViewById(track.automationRegion.id);
                    if (regionView) {
                        regionView.redraw("", track.automationRegion);
                    }
                }
            };

        } else {
            // Hide: Remove Region and Header
            if (track.automationRegion) {
                this._app.regionsController.removeRegion(track.automationRegion);
            }

            const existingEl = document.getElementById("automation-track-" + track.id);
            if (existingEl && existingEl instanceof AutomationTrackElement) {
                this._app.tracksView.removeAutomationTrack(existingEl);
            }
        }

        this._app.editorView.resizeCanvas();
    }

    // Compatibility methods (can be empty or removed if not used)
    public async openAutomationMenu(track: Track): Promise<void> {
        // Now just toggles visibility
        this.toggleAutomationVisibility(track, !track.isAutomationOpened);
    }

    public async updateAutomations(track: Track): Promise<void> {
        // No-op, handled in toggleAutomationVisibility
    }

    /**
     * Applies all automation points to the plugins.
     * Should be called on play or seek.
     */
    public applyAllAutomations(): void {
        const tracks = this._app.tracksController.tracks;
        const currentTime = this._app.host.audioContext.currentTime;
        const currentPlayhead = this._app.host.playhead;

        for (const track of tracks) {
            if (!track.plugin?.instance?._audioNode) continue;
            const audioNode = track.plugin.instance._audioNode;

            // Clear existing events to avoid conflicts/duplicates
            audioNode.clearEvents();

            // 1. Current Automation (Active Region)
            if (track.automationRegion && track.automationRegion.paramId) {
                this.schedulePoints(audioNode, track.automationRegion.paramId, track.automationRegion.points, currentTime, currentPlayhead);
            }

            // 2. Stored Automations (Other Parameters)
            for (const [paramId, points] of track.automationData) {
                // Skip if it's the current one (already handled)
                if (track.automationRegion && paramId === track.automationRegion.paramId) continue;
                if (points && points.length > 0) {
                    this.schedulePoints(audioNode, paramId, points, currentTime, currentPlayhead);
                }
            }
        }
    }

    private schedulePoints(audioNode: any, paramId: string, points: any[], contextTime: number, currentPlayhead: number) {
        if (!points || points.length === 0) return;

        const events: any[] = [];

        // Find initial value (point right before or at playhead)
        // Sort just in case
        // points.sort((a, b) => a.time - b.time); // Assuming already sorted or expensive?
        // Let's assume sorted.

        let lastPointVal = points[0].value;
        let foundPrev = false;

        for (const p of points) {
            if (p.time <= currentPlayhead) {
                lastPointVal = p.value;
                foundPrev = true;
            } else {
                // Future point
                const deltaMs = p.time - currentPlayhead;
                const schedTime = contextTime + (deltaMs / 1000);
                events.push({
                    type: 'automation',
                    time: schedTime,
                    data: { id: paramId, value: p.value, normalized: true }
                });
            }
        }

        // Apply initial value immediately if we started past some points
        if (foundPrev || points[0].time > currentPlayhead) {
            // If ALL points are in future, we might not want to touch current value? 
            // But if we have prior points, we MUST separate "setting state" from "scheduling".
            // WamNode doesn't always support "set value now" via event with time=now?
            // Usually it does.
            // But to be safe, we can trigger an event with time = contextTime.
            events.push({
                type: 'automation',
                time: contextTime,
                data: { id: paramId, value: lastPointVal, normalized: true }
            });
        }

        // Sort events by time before scheduling (WAM requirement usually)
        events.sort((a, b) => a.time - b.time);

        if (events.length > 0) {
            audioNode.scheduleEvents(events);
        }
    }

    public updateBPFWidth(): void {
        // No-op
    }

    public static getStartingPoint(totalDuration: number, currentTime: number, totalPoint: number): number {
        const point = (totalPoint * currentTime) / totalDuration;
        const integPoint = Math.floor(point);
        const frac = point - integPoint;
        if (frac < 0.5) return integPoint;
        else return integPoint + 1;
    }
}
