import App from "../App";
import { ZOOM_LEVEL } from "../Env";
import { isKeyPressed, registerOnKeyDown, registerOnKeyUp } from "../Utils/keys";

/**
 * The class that control the events related to the keyboard.
 */
export default class KeyboardController {

    /**
     * Route Application.
     */
    private _app: App;

    constructor(app: App) {
        this._app = app;

        this.bindEvents();
    }

    /**
     * Bind on initialisation the events related to the keyboard : keypress, keydown, keyup and so on...
     * @private
     */
    private bindEvents() {
        // Global Shortcuts
        window.addEventListener("keydown", (e) => {
            if (this._app.shortcutController.isTriggered("project.save", e)) {
                e.preventDefault();
                this._app.projectController.openSaveWindow();
            }
        });

        // Use 'keydown' for Play/Pause to be responsive, or stick to 'keyup' if desired.
        // Original was 'keyup' for space. Let's see if we can support that.
        // ShortcutController checks 'keydown' usually (modifiers are best checked on down).
        // If we want to support 'keyup' triggers, we need to adapt ShortcutController or just use the event key.
        // But space for play/pause is often keydown in games/DAWs.
        // Let's switch to a unified keydown listener for shortcuts if possible, or support both.
        // For now, I will use keydown for everything to be consistent with 'shortcuts'.
        // If the user *holds* space, it might toggle repeatedly?
        // Usually we want 'on press'.
        // Let's use registerOnKeyDown but check if repeated?

        // Actually, let's keep the existing structure but use ShortcutController to CHECK.
        // BUT ShortcutController expects KeyboardEvent. 'registerOnKeyUp' provides it?
        // keys.ts: registerOnKeyUp(callback: (key:string)=>void) -> NO EVENT in callback signature in keys.ts for keyUp!
        // keys.ts: registerOnKeyDown(callback: (key:string, e:KeyboardEvent)=>void) -> HAS EVENT.

        // So for Space (Play/Pause), it was on KeyUp. The old code didn't check modifiers for Space.
        // If I move it to KeyDown, it will fire earlier.
        // Let's move Play/Pause to KeyDown for better responsiveness and consistency with other shortcuts.
        // But preventing repeat is important.

        registerOnKeyDown((key, e) => {
            if (e.repeat) return;

            if (this._app.shortcutController.isTriggered("transport.playPause", e)) {
                this._app.hostController.onPlayButton();
            }

            if (this._app.shortcutController.isTriggered("editor.zoomIn", e)) {
                this._app.editorController.zoomTo(ZOOM_LEVEL * 1.5);
            }
            if (this._app.shortcutController.isTriggered("editor.zoomOut", e)) {
                this._app.editorController.zoomTo(ZOOM_LEVEL / 1.5);
            }
        });

        // Previous separate registerOnKeyDown removed as merged above

    }

}