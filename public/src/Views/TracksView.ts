import TrackElement from "../Components/Editor/TrackElement";
import AutomationTrackElement from "../Components/Editor/AutomationTrackElement";

/**
 * Class that is responsible for the view of the tracks.
 * It is responsible for adding and removing tracks from the track view.
 */
export default class TracksView {

    trackContainerDiv: HTMLDivElement = document.getElementById("track-container") as HTMLDivElement;
    newTrackDiv: HTMLDivElement = document.getElementById("new-track") as HTMLDivElement;

    /**
     * Adds a TrackElement to the track view.
     * @param trackElement
     * @param position - The position to add the track at. Default is the end of the track view.
     */
    public addTrack(trackElement: TrackElement, position: number = this.trackContainerDiv.children.length - 3): void {
        console.log("Adding track at position: " + position);
        this.trackContainerDiv.children[position + 1].before(trackElement);
    }
    /**
     * Removes a TrackElement from the track view.
     * @param el - The track to remove.
     */
    public removeTrack(el: TrackElement): void {
        el.remove();
    }

    /**
     * Adds the automation track element right after the track element.
     * @param trackElement The track element to append the automation track after.
     * @param automationTrackElement The automation track element to add.
     */
    public addAutomationTrack(trackElement: TrackElement, automationTrackElement: AutomationTrackElement): void {
        trackElement.after(automationTrackElement);
    }

    /**
     * Removes the automation track element.
     * @param automationTrackElement The automation track element to remove.
     */
    public removeAutomationTrack(automationTrackElement: AutomationTrackElement): void {
        automationTrackElement.remove();
    }
}