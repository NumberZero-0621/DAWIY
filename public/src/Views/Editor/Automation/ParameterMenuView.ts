import { ParameterDefinition } from "../../../Controllers/AutomationController";

export default class ParameterMenuView {

    private _menu: HTMLElement;
    private _subMenu: HTMLElement | null = null;
    private _callback: (id: string) => void;
    private _activePlugin: string | null = null;

    constructor() {
        this._menu = document.createElement("div");
        this._menu.className = "parameter-menu";
        this._menu.style.display = "none";
        this._menu.style.position = "fixed";
        this._menu.style.zIndex = "10000";
        this._menu.style.backgroundColor = "#2b2b2b";
        this._menu.style.border = "1px solid #454545";
        this._menu.style.boxShadow = "2px 2px 10px rgba(0,0,0,0.5)";
        this._menu.style.padding = "5px 0";
        this._menu.style.minWidth = "180px";
        this._menu.style.borderRadius = "4px";
        this._menu.style.fontFamily = "sans-serif";
        this._menu.style.fontSize = "12px";
        this._menu.style.color = "#e0e0e0";
        this._menu.style.maxHeight = "80vh";
        this._menu.style.overflowY = "auto";

        document.body.appendChild(this._menu);

        window.addEventListener("mousedown", (e) => {
            if (!this._menu.contains(e.target as Node) && (!this._subMenu || !this._subMenu.contains(e.target as Node))) {
                this.hide();
            }
        });
    }

    public show(x: number, y: number, params: ParameterDefinition[], automatedIds: string[], callback: (id: string) => void) {
        this._callback = callback;
        this._menu.innerHTML = "";
        this._activePlugin = null;
        this.destroySubMenu();

        const automatedSet = new Set(automatedIds);

        // カテゴリ別に整理
        const categories = new Map<string, ParameterDefinition[]>();
        params.forEach(p => {
            const cat = p.category || "Other";
            if (!categories.has(cat)) categories.set(cat, []);
            categories.get(cat)!.push(p);
        });

        // Main (Volume/Pan) はトップレベルに表示
        if (categories.has("Main")) {
            categories.get("Main")!.forEach(p => {
                const isAutomated = automatedSet.has(p.id);
                this._menu.appendChild(this.createItem(p.label, () => {
                    this._callback(p.id);
                    this.hide();
                }, false, false, isAutomated));
            });
            const sep = document.createElement("div");
            sep.style.height = "1px";
            sep.style.backgroundColor = "#454545";
            sep.style.margin = "4px 0";
            this._menu.appendChild(sep);
            categories.delete("Main");
        }

        // 各プラグインをフォルダとして表示
        categories.forEach((items, cat) => {
            // フォルダ内に編集済みが含まれるかチェック
            const hasAutomatedInFolder = items.some(p => automatedSet.has(p.id));
            const folder = this.createItem(cat, () => {}, true, false, hasAutomatedInFolder);
            folder.addEventListener("mouseenter", () => {
                this.showSubMenu(folder, items, automatedSet);
            });
            this._menu.appendChild(folder);
        });

        this._menu.style.display = "block";
        this.positionMenu(this._menu, x, y);
    }

    private createItem(label: string, onClick: () => void, isFolder: boolean = false, isSubMenuItem: boolean = false, isAutomated: boolean = false): HTMLElement {
        const el = document.createElement("div");
        el.style.padding = "6px 20px";
        el.style.cursor = "pointer";
        el.style.display = "flex";
        el.style.justifyContent = "space-between";
        el.style.alignItems = "center";

        const labelSpan = document.createElement("span");
        labelSpan.innerText = label;
        el.appendChild(labelSpan);

        if (isAutomated) {
            const indicator = document.createElement("span");
            indicator.innerText = "●";
            indicator.style.fontSize = "10px";
            indicator.style.color = "#e0e0e0";
            indicator.style.marginLeft = "8px";
            el.appendChild(indicator);
        } else if (isFolder) {
            const arrow = document.createElement("span");
            arrow.innerText = "▶";
            arrow.style.fontSize = "8px";
            arrow.style.opacity = "0.5";
            el.appendChild(arrow);
        }

        el.addEventListener("mouseenter", () => {
            el.style.backgroundColor = "#007fd4";
            el.style.color = "#ffffff";
            if (!isFolder && !isSubMenuItem) this.destroySubMenu();
        });
        el.addEventListener("mouseleave", () => {
            el.style.backgroundColor = "transparent";
            el.style.color = "#e0e0e0";
        });
        el.addEventListener("click", (e) => {
            e.stopPropagation();
            onClick();
        });

        return el;
    }

    private showSubMenu(parentEl: HTMLElement, items: ParameterDefinition[], automatedSet: Set<string>) {
        this.destroySubMenu();

        this._subMenu = document.createElement("div");
        this._subMenu.className = "parameter-submenu";
        this._subMenu.style.position = "fixed";
        this._subMenu.style.zIndex = "10001";
        this._subMenu.style.backgroundColor = "#2b2b2b";
        this._subMenu.style.border = "1px solid #454545";
        this._subMenu.style.boxShadow = "2px 2px 10px rgba(0,0,0,0.5)";
        this._subMenu.style.padding = "5px 0";
        this._subMenu.style.minWidth = "180px";
        this._subMenu.style.borderRadius = "4px";
        this._subMenu.style.fontFamily = "sans-serif";
        this._subMenu.style.fontSize = "12px";
        this._subMenu.style.color = "#e0e0e0";
        this._subMenu.style.maxHeight = "80vh";
        this._subMenu.style.overflowY = "auto";

        items.forEach(p => {
            const isAutomated = automatedSet.has(p.id);
            this._subMenu!.appendChild(this.createItem(p.label, () => {
                this._callback(p.id);
                this.hide();
            }, false, true, isAutomated)); // サブメニューアイテムとして作成
        });

        document.body.appendChild(this._subMenu);

        const rect = parentEl.getBoundingClientRect();
        this.positionMenu(this._subMenu, rect.right, rect.top);
    }

    private positionMenu(el: HTMLElement, x: number, y: number) {
        let posX = x;
        let posY = y;
        const rect = el.getBoundingClientRect();

        if (posX + rect.width > window.innerWidth) {
            posX = x - rect.width - (el === this._menu ? 0 : 180); // サブメニューの場合は左側に
        }
        if (posY + rect.height > window.innerHeight) {
            posY = window.innerHeight - rect.height - 10;
        }

        el.style.left = posX + "px";
        el.style.top = posY + "px";
    }

    private destroySubMenu() {
        if (this._subMenu) {
            this._subMenu.remove();
            this._subMenu = null;
        }
    }

    public hide() {
        this._menu.style.display = "none";
        this.destroySubMenu();
    }
}
