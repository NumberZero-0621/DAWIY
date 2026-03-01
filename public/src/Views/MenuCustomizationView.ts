import DraggableWindow from "../Utils/DraggableWindow";
import App from "../App";
import { MenuConfig } from "../Utils/MenuConfig";
import { t } from "../Utils/i18n";
import TemplateLoader from "../TemplateLoader";

export default class MenuCustomizationView extends DraggableWindow {

    app: App;
    listElement!: HTMLUListElement;
    resetBtn!: HTMLButtonElement;

    constructor(app: App) {
        super(
            document.getElementById("menu-custom-header") as HTMLDivElement,
            document.getElementById("menu-customization-window") as HTMLDivElement
        );
        this.app = app;
        this.initElements();
        this.bindEvents();
    }

    private initElements() {
        this.listElement = this.resizableWindow.querySelector("#menu-custom-list") as HTMLUListElement;
        this.resetBtn = this.resizableWindow.querySelector("#menu-custom-reset-btn") as HTMLButtonElement;

        const closeBtn = this.resizableWindow.querySelector("#menu-custom-close-button") as HTMLButtonElement;
        if (closeBtn) {
            closeBtn.onclick = () => this.closeWindow();
        }
    }

    private bindEvents() {
        this.resetBtn.onclick = async () => {
            if (await confirm(t("messages.confirm_reset_shortcuts"))) {
                const defaults = MenuConfig.reset();
                this.renderList(defaults);
                this.app.hostController.refreshHamburgerMenu();
            }
        };
    }

    public openWindow() {
        this.resizableWindow.hidden = false;
        this.renderList(MenuConfig.load());
    }

    public closeWindow() {
        this.resizableWindow.hidden = true;
    }

    private renderList(config: any[]) {
        this.listElement.innerHTML = "";

        config.forEach(item => {
            const li = document.createElement("li");
            li.className = "menu-custom-item";
            li.draggable = true;
            li.dataset.id = item.id;

            const checkbox = document.createElement("input");
            checkbox.type = "checkbox";
            checkbox.className = "menu-custom-checkbox";
            checkbox.checked = item.visible;
            checkbox.disabled = item.id === "settings";

            checkbox.onchange = () => {
                item.visible = checkbox.checked;
                this.saveConfig();
            };

            const label = document.createElement("span");
            label.className = "menu-custom-label";
            label.innerText = t(item.i18nKey);

            li.appendChild(checkbox);
            li.appendChild(label);

            this.bindDragEvents(li);

            this.listElement.appendChild(li);
        });
    }

    private bindDragEvents(li: HTMLLIElement) {
        li.addEventListener('dragstart', (e) => {
            li.classList.add('dragging');
        });

        li.addEventListener('dragend', (e) => {
            li.classList.remove('dragging');
            this.updateOrderFromDOM();
        });

        this.listElement.addEventListener('dragover', (e) => {
            e.preventDefault();
            const afterElement = this.getDragAfterElement(this.listElement, e.clientY);
            const draggable = document.querySelector('.dragging');
            if (draggable) {
                if (afterElement == null) {
                    this.listElement.appendChild(draggable);
                } else {
                    this.listElement.insertBefore(draggable, afterElement);
                }
            }
        });
    }

    private getDragAfterElement(container: HTMLElement, y: number) {
        const draggableElements = [...container.querySelectorAll('.menu-custom-item:not(.dragging)')];

        return draggableElements.reduce((closest, child) => {
            const box = child.getBoundingClientRect();
            const offset = y - box.top - box.height / 2;
            if (offset < 0 && offset > closest.offset) {
                return { offset: offset, element: child };
            } else {
                return closest;
            }
        }, { offset: Number.NEGATIVE_INFINITY, element: null } as any).element;
    }

    private updateOrderFromDOM() {
        const currentConfig = MenuConfig.load();
        const newOrder: any[] = [];

        const items = this.listElement.querySelectorAll(".menu-custom-item");
        items.forEach((item, index) => {
            const htmlItem = item as HTMLElement;
            const id = htmlItem.dataset.id;
            const configItem = currentConfig.find(c => c.id === id);
            if (configItem) {
                configItem.order = index;
                newOrder.push(configItem);
            }
        });

        MenuConfig.save(newOrder);
        this.app.hostController.refreshHamburgerMenu();
    }

    private saveConfig() {
        const items = this.listElement.querySelectorAll(".menu-custom-item");
        const currentConfig = MenuConfig.load();

        items.forEach((item, index) => {
            const htmlItem = item as HTMLElement;
            const id = htmlItem.dataset.id;
            const checkbox = htmlItem.querySelector("input[type='checkbox']") as HTMLInputElement;
            const configItem = currentConfig.find(c => c.id === id);
            if (configItem) {
                configItem.visible = checkbox.checked;
                configItem.order = index; // Ensure order is preserved/updated
            }
        });

        MenuConfig.save(currentConfig);
        this.app.hostController.refreshHamburgerMenu();
    }
}
