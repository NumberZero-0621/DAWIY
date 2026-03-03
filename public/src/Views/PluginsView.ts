import Track from "../Models/Track/Track";
import DraggableWindow from "../Utils/DraggableWindow";


export default class PluginsView extends DraggableWindow {

    onPluginClick: (name: string) => void = () => { }

    maxMinBtn = document.getElementById("min-max-btn") as HTMLDivElement;
    rack = document.getElementById("plugin-editor") as HTMLDivElement;
    onAddClick: (pluginName: string) => void = () => { }
    onBypassRackClick: () => void = () => { }
    onRemovePluginClick: (index: number) => void = () => { }
    onToggleShowPluginClick: (pluginId: string, index: number) => void = () => { }


    rackBypassBtn = document.getElementById("rack-bypass-btn") as HTMLButtonElement;
    rackAddBtn = document.getElementById("rack-add-btn") as HTMLButtonElement;
    rackList = document.getElementById("plugin-rack-list") as HTMLDivElement;

    pluginAddDropdown = document.getElementById("plugin-add-dropdown") as HTMLDivElement;
    pluginAddDropdownList = document.getElementById("plugin-add-dropdown-list") as HTMLDivElement;

    mount = document.getElementById("mount") as HTMLDivElement;
    floating = document.getElementById("plugin-window") as HTMLDivElement;
    closeWindowButton = document.getElementById("plugin-close-button") as HTMLDivElement;
    mainTrack = document.getElementById("main-track") as HTMLDivElement;
    minMaxIcon = document.getElementById("min-max-icon") as HTMLImageElement;
    loadingZone = document.getElementById("loading-zone") as HTMLDivElement;

    constructor() {
        super(document.getElementById("plugin-header") as HTMLDivElement, document.getElementById("plugin-window") as HTMLDivElement);
        this.rackAddBtn.addEventListener("click", () => {
            const isShowing = this.pluginAddDropdown.style.display === "block";
            this.toggleAddDropdown(!isShowing);
        });

        // click outside to close dropdown
        document.addEventListener("click", (e) => {
            if (!this.pluginAddDropdown.contains(e.target as Node) && !this.rackAddBtn.contains(e.target as Node)) {
                this.toggleAddDropdown(false);
            }
        });

        this.rackBypassBtn.addEventListener("click", () => this.onBypassRackClick());
    }

    /** If the window is opened or not. */
    public windowOpened: boolean = false;

    /** If the rack is maximized or not. */
    public maximized: boolean;

    /** The collapsed height of the rack. */
    private readonly COLLAPSED_HEIGHT: number = 25;

    /** The default expanded height of the rack. */
    public lastUserHeight: number = 250;

    /** Maximizes the rack to the maximum height and change the icon to minimize. */
    maximize() {
        this.minMaxIcon.className = "arrow-down-icon";
        this.rack.style.height = this.COLLAPSED_HEIGHT + "px";
        this.rack.style.minHeight = this.COLLAPSED_HEIGHT + "px";
    }

    /** Minimizes the rack to the minimum height and change the icon to maximize. */
    minimize() {
        this.minMaxIcon.className = "arrow-up-icon";
        this.rack.style.height = this.lastUserHeight + "px";
        this.rack.style.minHeight = this.lastUserHeight + "px";
    }

    /**
     * Set the plugin's view in the DOM.
     */
    setPluginView(element: Element | null) {
        if (this.mount.children[0] === element) return
        this.mount.replaceChildren(...element ? [element] : []);
    }

    /**
     * Render the plugin list in the rack
     */
    renderPluginList(plugins: { name: string; isBypassed?: boolean, isVisible?: boolean }[]) {
        this.rackList.innerHTML = "";
        plugins.forEach((plugin, index) => {
            const item = document.createElement("div");
            item.style.display = "flex";
            item.style.justifyContent = "space-between";
            item.style.alignItems = "center";
            item.style.background = "#2a2a2a";
            item.style.padding = "6px 10px";
            item.style.borderRadius = "4px";
            item.style.border = "1px solid #444";

            // Name area
            const nameEl = document.createElement("div");
            nameEl.textContent = plugin.name;
            nameEl.style.color = "#ccc";
            nameEl.style.fontSize = "13px";
            nameEl.style.flexGrow = "1";
            nameEl.style.cursor = "pointer";

            // Click name to toggle UI window
            nameEl.onclick = () => this.onToggleShowPluginClick(plugin.name, index);

            // Controls area
            const controlsEl = document.createElement("div");
            controlsEl.style.display = "flex";
            controlsEl.style.gap = "5px";

            // Visual toggle (eye icon)
            const toggleUiBtn = document.createElement("button");
            toggleUiBtn.className = "btn btn-sm";
            toggleUiBtn.style.background = "transparent";
            toggleUiBtn.style.color = plugin.isVisible ? "#4db8ff" : "#777";
            toggleUiBtn.style.border = "none";
            toggleUiBtn.style.padding = "0 5px";
            toggleUiBtn.innerHTML = `<i class="bi ${plugin.isVisible ? 'bi-eye-fill' : 'bi-eye-slash'}"></i>`;
            toggleUiBtn.title = plugin.isVisible ? "Hide UI" : "Show UI";
            toggleUiBtn.onclick = () => this.onToggleShowPluginClick(plugin.name, index);

            // Remove button
            const removeBtn = document.createElement("button");
            removeBtn.className = "btn btn-sm";
            removeBtn.style.background = "transparent";
            removeBtn.style.color = "#d9534f";
            removeBtn.style.border = "none";
            removeBtn.style.padding = "0 5px";
            removeBtn.innerHTML = `<i class="bi bi-x-circle"></i>`;
            removeBtn.title = "Remove Plugin";
            removeBtn.onclick = () => this.onRemovePluginClick(index);

            controlsEl.appendChild(toggleUiBtn);
            controlsEl.appendChild(removeBtn);

            item.appendChild(nameEl);
            item.appendChild(controlsEl);

            this.rackList.appendChild(item);
        });
    }

    /**
     * Shows or hide the floating window
     * @param doShow Do show the floating window or hide it
     */
    showFloatingWindow(doShow: boolean) {
        this.floating.hidden = !doShow
        this.windowOpened = doShow
    }

    /**
     * Toggles the display of the add plugin dropdown.
     */
    toggleAddDropdown(show: boolean) {
        this.pluginAddDropdown.style.display = show ? "block" : "none";
    }

    /**
     * Renders the list of available plugins in the add dropdown.
     */
    renderAddDropdown(pluginNames: string[]) {
        this.pluginAddDropdownList.innerHTML = "";
        if (pluginNames.length === 0) {
            const emptyItem = document.createElement("div");
            emptyItem.textContent = "No plugins available";
            emptyItem.style.padding = "5px 10px";
            emptyItem.style.color = "#777";
            emptyItem.style.fontSize = "12px";
            this.pluginAddDropdownList.appendChild(emptyItem);
            return;
        }

        pluginNames.forEach(name => {
            const item = document.createElement("div");
            item.textContent = name;
            item.style.padding = "6px 12px";
            item.style.cursor = "pointer";
            item.style.borderBottom = "1px solid #444";
            item.style.color = "#ccc";
            item.style.fontSize = "13px";
            item.onmouseenter = () => item.style.background = "#444";
            item.onmouseleave = () => item.style.background = "transparent";
            item.onclick = () => {
                this.toggleAddDropdown(false);
                this.onAddClick(name); // onAddClick should now take a name
            };
            this.pluginAddDropdownList.appendChild(item);
        });
    }

    /**
     * Selects the main track and set the border to lightgrey.
     */
    selectHost() {
        this.mainTrack.style.border = "1px solid lightgrey";
    }

    /**
     * Unselects the main track and set the border to black.
     */
    unselectHost() {
        this.mainTrack.style.border = "1px solid black";
    }

    /**
     * Moves all plugin views of the given track to the loading zone.
     * @param track - The track to move the plugin's view from.
     */
    movePluginLoadingZone(track: Track) {
        if (track.plugins) {
            for (const p of track.plugins) {
                if (p.instance) {
                    this.loadingZone.appendChild(p.gui);
                }
            }
        }
    }
}