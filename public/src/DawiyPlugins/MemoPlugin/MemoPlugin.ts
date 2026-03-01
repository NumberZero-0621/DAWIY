import { Application, Container, Graphics, FederatedPointerEvent, Text, Point, IPointData, Rectangle } from "pixi.js";
import App from "../../App";
import { DAWIYPlugin } from "../IDawiyPlugin";
import DawiyPluginBase from "../DawiyPluginBase";
import { RATIO_MILLS_BY_PX, RATIO_MILLS_BY_PX_FOR_120_BPM } from "../../Env";
type ToolType = "PEN" | "ERASER" | "STICKY" | "TEXT";

interface MemoData {
    id: string;
    type: "PEN" | "STICKY" | "TEXT";
    x: number;
    y: number;
    text?: string;
    path?: { x: number, y: number }[];
    color?: number;
    size?: number;
    font?: string;
}

@DAWIYPlugin
export default class MemoPlugin extends DawiyPluginBase {
    id = "memo-plugin";
    name = "Memo / Sticky Notes";
    description = "Draw freehand notes and add sticky notes to the track view.";
    group = "Tools";

    // PIXI Elements
    private memoContainer: Container;
    private currentGraphics: Graphics | null = null;

    // State
    private currentTool: ToolType = "PEN";
    private brushColor = 0xFFFF00;
    private brushSize = 4;
    private textColor = 0xFFFFFF;
    private textSize = 16;
    private textFont = "Arial";
    private availableFonts: string[] = ["Arial", "Courier New", "Georgia", "Times New Roman", "Verdana", "sans-serif", "serif", "monospace"];

    private isDrawing = false;
    private currentPath: Point[] = [];
    private isPluginActive = false;

    private memos: MemoData[] = [];
    private selectedElements: Set<Container> = new Set();
    private isSelecting = false;
    private selectionStart: Point | null = null;
    private selectionGraphics: Graphics | null = null;

    private readonly fontMap: Record<string, string> = {
        "Yu Mincho": "游明朝",
        "Yu Gothic": "游ゴシック",
        "Meiryo": "メイリオ",
        "MS Gothic": "ＭＳ ゴシック",
        "MS Mincho": "ＭＳ 明朝"
    };

    // Sticky
    private stickyCounter = 0;

    // Zoom scaling base ratio
    private readonly baseRatio = RATIO_MILLS_BY_PX_FOR_120_BPM;

    constructor(app: App) {
        super(app);
        this.memoContainer = new Container();
        this.memoContainer.zIndex = 200; // Above regions (usually < 100) and selection box (100)

        // Sync scaling with zoom
        this.app.editorView.ticker.add(() => {
            if (RATIO_MILLS_BY_PX > 0) {
                this.memoContainer.scale.x = this.baseRatio / RATIO_MILLS_BY_PX;
            }
        });

        // Make sure it's added to viewport after initialization, e.g. setTimeout to wait for app boot
        setTimeout(() => {
            if (!this.memoContainer.parent && this.app.editorView && this.app.editorView.viewport) {
                this.app.editorView.viewport.addChild(this.memoContainer);
            }
        }, 500);

        // Try load from local storage immediately as fallback
        try {
            const stored = localStorage.getItem(`dawiy_plugin_user_data_${this.id}`);
            if (stored) {
                const parsed = JSON.parse(stored);
                if (parsed.memos && this.memos.length === 0) {
                    this.memos = parsed.memos;
                    this.renderMemos();
                }
            }
        } catch (e) {
            console.warn(`Failed to load user data for plugin ${this.name}`, e);
        }
    }

    public override getProjectData(): any {
        return { memos: this.memos };
    }

    public override setProjectData(data: any): void {
        if (data && data.memos) {
            this.memos = data.memos;
            this.renderMemos();
        }
    }

    public override getUserData(): any {
        return { memos: this.memos };
    }

    public override setUserData(data: any): void {
        if (data && data.memos) {
            // Only overwrite if we don't already have newer memos, but for now we trust the flow
            this.memos = data.memos;
            this.renderMemos();
        }
    }

    private commitMemos(newMemos: MemoData[]) {
        const oldMemos = JSON.parse(JSON.stringify(this.memos));
        const nextMemos = JSON.parse(JSON.stringify(newMemos));

        this.app.doIt(true, () => {
            this.memos = JSON.parse(JSON.stringify(nextMemos));
            this.renderMemos();
            this.saveAuto();
        }, () => {
            this.memos = JSON.parse(JSON.stringify(oldMemos));
            this.renderMemos();
            this.saveAuto();
        });
    }

    private saveAuto() {
        try {
            localStorage.setItem(`dawiy_plugin_user_data_${this.id}`, JSON.stringify({ memos: this.memos }));
            // Trigger DAWIY's autosave immediately so project data isn't stale on reload
            if (this.app && this.app.autoSaveController) {
                this.app.autoSaveController.save();
            }
        } catch (e) { }
    }

    private renderMemos() {
        const selectedIds = new Set(Array.from(this.selectedElements).map(el => (el as any).memoId));
        this.selectedElements.clear();

        this.memoContainer.removeChildren();

        for (const memo of this.memos) {
            if (memo.type === "STICKY") {
                this.renderSticky(memo);
            } else if (memo.type === "TEXT") {
                this.renderText(memo);
            } else if (memo.type === "PEN") {
                this.renderPen(memo);
            }
        }

        // Re-apply selection
        for (const child of this.memoContainer.children) {
            if (selectedIds.has((child as any).memoId)) {
                this.selectElement(child as Container, true);
            }
        }
    }

    public override render(container: HTMLElement) {
        this.container = container;
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

        const toolsDiv = document.createElement("div");
        toolsDiv.style.display = "flex";
        toolsDiv.style.gap = "5px";

        // Tool Buttons
        this.createToolBtn(toolsDiv, "PEN", "✏️");
        this.createToolBtn(toolsDiv, "ERASER", "🧹");
        this.createToolBtn(toolsDiv, "STICKY", "📝");
        this.createToolBtn(toolsDiv, "TEXT", "T");

        container.appendChild(toolsDiv);

        // Options (Dynamic based on tool)
        const optionsDiv = document.createElement("div");
        optionsDiv.id = "memo-options";
        container.appendChild(optionsDiv);

        this.renderOptions(optionsDiv);

        const help = document.createElement("p");
        help.textContent = "Draw freely on the tracks. Memos stick to the timeline position.";
        help.style.fontSize = "12px";
        help.style.color = "#aaa";
        container.appendChild(help);

        // Ensure overlay is active if this render is called (implies selection)
        this.activateOverlay();
    }

    private createToolBtn(parent: HTMLElement, type: ToolType, icon: string) {
        const btn = document.createElement("button");
        btn.textContent = icon;
        btn.title = type;
        btn.style.padding = "8px";
        btn.style.background = this.currentTool === type ? "#E91E63" : "#444";
        btn.style.color = "white";
        btn.style.border = "none";
        btn.style.cursor = "pointer";
        btn.style.borderRadius = "4px";
        btn.onclick = () => {
            this.currentTool = type;
            // Update UI
            Array.from(parent.children).forEach((c: any) => {
                c.style.background = "#444";
            });
            btn.style.background = "#E91E63";

            const opts = document.getElementById("memo-options");
            if (opts) this.renderOptions(opts);
        };
        parent.appendChild(btn);
    }

    private renderOptions(container: HTMLElement) {
        container.innerHTML = "";
        container.style.display = "flex";
        container.style.flexDirection = "column";
        container.style.gap = "5px";

        if (this.currentTool === "PEN") {
            // Color
            const colorRow = document.createElement("div");
            colorRow.style.display = "flex";
            colorRow.style.alignItems = "center";
            colorRow.style.gap = "5px";
            const colorLabel = document.createElement("span");
            colorLabel.textContent = "Color:";
            const colorInput = document.createElement("input");
            colorInput.type = "color";
            colorInput.value = "#" + this.brushColor.toString(16).padStart(6, '0');
            colorInput.oninput = () => {
                this.brushColor = parseInt(colorInput.value.replace("#", ""), 16);
            };
            colorRow.appendChild(colorLabel);
            colorRow.appendChild(colorInput);
            container.appendChild(colorRow);

            // Size
            const sizeRow = document.createElement("div");
            sizeRow.style.display = "flex";
            sizeRow.style.alignItems = "center";
            sizeRow.style.gap = "5px";
            const sizeLabel = document.createElement("span");
            sizeLabel.textContent = "Size:";
            const sizeInput = document.createElement("input");
            sizeInput.type = "number";
            sizeInput.min = "1";
            sizeInput.max = "50";
            sizeInput.value = this.brushSize.toString();
            sizeInput.style.width = "40px";
            sizeInput.oninput = () => {
                this.brushSize = parseInt(sizeInput.value);
            };
            sizeRow.appendChild(sizeLabel);
            sizeRow.appendChild(sizeInput);
            container.appendChild(sizeRow);
        } else if (this.currentTool === "TEXT") {
            // Text Color
            const colorRow = document.createElement("div");
            colorRow.style.display = "flex";
            colorRow.style.alignItems = "center";
            colorRow.style.gap = "5px";
            const colorLabel = document.createElement("span");
            colorLabel.textContent = "Color:";
            const colorInput = document.createElement("input");
            colorInput.type = "color";
            colorInput.value = "#" + this.textColor.toString(16).padStart(6, '0');
            colorInput.oninput = () => {
                this.textColor = parseInt(colorInput.value.replace("#", ""), 16);
            };
            colorRow.appendChild(colorLabel);
            colorRow.appendChild(colorInput);
            container.appendChild(colorRow);

            // Text Size
            const sizeRow = document.createElement("div");
            sizeRow.style.display = "flex";
            sizeRow.style.alignItems = "center";
            sizeRow.style.gap = "5px";
            const sizeLabel = document.createElement("span");
            sizeLabel.textContent = "Size:";
            const sizeInput = document.createElement("input");
            sizeInput.type = "number";
            sizeInput.min = "8";
            sizeInput.max = "150";
            sizeInput.value = this.textSize.toString();
            sizeInput.style.width = "40px";
            sizeInput.oninput = () => {
                this.textSize = parseInt(sizeInput.value);
            };
            sizeRow.appendChild(sizeLabel);
            sizeRow.appendChild(sizeInput);
            container.appendChild(sizeRow);

            // Font Family
            const fontRow = document.createElement("div");
            fontRow.style.display = "flex";
            fontRow.style.alignItems = "center";
            fontRow.style.gap = "5px";
            const fontLabel = document.createElement("span");
            fontLabel.textContent = "Font:";
            const fontSelect = document.createElement("select");

            const updateFontList = (fonts: string[]) => {
                fontSelect.innerHTML = "";
                fonts.forEach(f => {
                    const opt = document.createElement("option");
                    opt.value = f;
                    opt.textContent = this.fontMap[f] || f;
                    if (f === this.textFont) opt.selected = true;
                    fontSelect.appendChild(opt);
                });
            };
            updateFontList(this.availableFonts);

            // Try to load local fonts
            if ('queryLocalFonts' in window) {
                (window as any).queryLocalFonts().then((localFonts: any[]) => {
                    const fontFamilies = Array.from(new Set(localFonts.map(f => f.family)));
                    if (fontFamilies.length > 0) {
                        this.availableFonts = fontFamilies as string[];
                        if (!this.availableFonts.includes(this.textFont)) {
                            this.textFont = this.availableFonts[0];
                        }
                        updateFontList(this.availableFonts);
                    }
                }).catch((e: any) => {
                    console.warn("Could not query local fonts, using fallbacks.", e);
                });
            }

            fontSelect.onchange = () => {
                this.textFont = fontSelect.value;
            };
            fontRow.appendChild(fontLabel);
            fontRow.appendChild(fontSelect);
            container.appendChild(fontRow);
        } else if (this.currentTool === "ERASER") {
            const clearBtn = document.createElement("button");
            clearBtn.textContent = "Clear All Memos";
            clearBtn.style.padding = "5px";
            clearBtn.style.background = "#D32F2F";
            clearBtn.style.color = "white";
            clearBtn.style.border = "none";
            clearBtn.style.cursor = "pointer";
            clearBtn.onclick = async (e) => {
                e.preventDefault();
                e.stopPropagation();

                // In some environments like Tauri v2, confirm() is overridden to return a Promise.
                // Awaiting it ensures it works correctly both synchronously (browser) and asynchronously (Tauri).
                const confirmed = await confirm("Clear all drawings and notes?");

                if (confirmed) {
                    this.commitMemos([]);
                }
            };
            container.appendChild(clearBtn);
        }
    }

    public override onActivate() {
        this.activateOverlay();
        window.addEventListener('keydown', this.handleKeyDown);
        window.addEventListener('contextmenu', this.handleContextMenu, { capture: true });
    }

    public override onDeactivate() {
        this.deactivateOverlay();
        window.removeEventListener('keydown', this.handleKeyDown);
        window.removeEventListener('contextmenu', this.handleContextMenu, { capture: true });
    }

    private handleContextMenu = (e: MouseEvent) => {
        if (this.isPluginActive) {
            // Check if it's over the canvas to avoid blocking UI panels' context menus entirely if needed,
            // but for safety, blocking it globally or on canvas while drawing is fine.
            // When right-click dragging is finished, `target` is usually the canvas.
            if (e.target instanceof HTMLCanvasElement) {
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();
            }
        }
    }

    private handleKeyDown = (e: KeyboardEvent) => {
        if (!this.isPluginActive || this.selectedElements.size === 0) return;

        // Ensure we are not inside an input field (so we don't delete text while typing)
        if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

        if (e.key === 'Delete' || e.key === 'Backspace') {
            const idsToDelete = new Set(Array.from(this.selectedElements).map(el => (el as any).memoId));
            const newMemos = this.memos.filter(m => !idsToDelete.has(m.id));
            if (newMemos.length !== this.memos.length) {
                this.commitMemos(newMemos);
            }
        }
    }

    private activateOverlay() {
        if (this.isPluginActive) return;
        this.isPluginActive = true;

        if (!this.memoContainer.parent) {
            this.app.editorView.viewport.addChild(this.memoContainer);
        }

        // Set a huge hit area so it intercepts clicks anywhere in the editor while active
        this.memoContainer.hitArea = new Rectangle(-1000000, -1000000, 2000000, 2000000);
        this.memoContainer.eventMode = 'static';

        // Bind events to the container instead of the viewport
        this.memoContainer.on("pointerdown", this.onPointerDown, this);
        this.memoContainer.on("pointermove", this.onPointerMove, this);
        this.memoContainer.on("pointerup", this.onPointerUp, this);
        this.memoContainer.on("pointerupoutside", this.onPointerUp, this);
    }

    private deactivateOverlay() {
        if (!this.isPluginActive) return;
        this.isPluginActive = false;

        // Note: We DO NOT remove the child from viewport, because we want the memos to PERSIST visually
        // even when the plugin tab is closed, OR? 
        // User request: "Memo on track editing screen". 
        // Typically, if I close the plugin panel, the tool is inactive, but should the memos disappear?
        // Let's assume they should stay visible.

        // Restore hitArea and events
        this.memoContainer.hitArea = null;
        this.memoContainer.eventMode = 'passive';

        this.memoContainer.off("pointerdown", this.onPointerDown, this);
        this.memoContainer.off("pointermove", this.onPointerMove, this);
        this.memoContainer.off("pointerup", this.onPointerUp, this);
        this.memoContainer.off("pointerupoutside", this.onPointerUp, this);
    }

    private lastPoint: Point = new Point();

    private onPointerDown(e: FederatedPointerEvent) {
        if (!this.isPluginActive) return;

        const nativeTarget = e.nativeEvent?.target as HTMLElement;
        if (nativeTarget && nativeTarget.tagName && nativeTarget.tagName.toUpperCase() !== 'CANVAS') {
            return;
        }

        // Prevent DAW default left-click actions (Region creation, Box selection) from firing
        e.stopPropagation();

        const localPos = this.memoContainer.toLocal(e.global);

        // Right click for marquee selection
        if (e.button === 2) {
            this.isSelecting = true;
            this.selectionStart = new Point(localPos.x, localPos.y);
            this.selectionGraphics = new Graphics();
            this.memoContainer.addChild(this.selectionGraphics);
            this.selectElement(null); // clear current selection
            return;
        }

        // Check if left click
        if (e.button !== 0) return;

        // Click on background unselects current element
        this.selectElement(null);

        if (this.currentTool === "PEN") {
            this.isDrawing = true;
            this.currentPath = [new Point(localPos.x, localPos.y)];
            this.currentGraphics = new Graphics();
            this.memoContainer.addChild(this.currentGraphics);
        } else if (this.currentTool === "STICKY") {
            this.createStickyNote(localPos.x, localPos.y);
        } else if (this.currentTool === "TEXT") {
            this.createFloatingText(localPos.x, localPos.y);
        }
    }

    private onPointerMove(e: FederatedPointerEvent) {
        if (!this.isPluginActive) return;

        const localPos = this.memoContainer.toLocal(e.global);

        if (this.isSelecting && this.selectionStart && this.selectionGraphics) {
            this.selectionGraphics.clear();
            this.selectionGraphics.lineStyle(1, 0x00AFFF, 1);
            this.selectionGraphics.beginFill(0x00AFFF, 0.2);

            const x = Math.min(this.selectionStart.x, localPos.x);
            const y = Math.min(this.selectionStart.y, localPos.y);
            const width = Math.abs(this.selectionStart.x - localPos.x);
            const height = Math.abs(this.selectionStart.y - localPos.y);

            this.selectionGraphics.drawRect(x, y, width, height);
            this.selectionGraphics.endFill();
            return;
        }

        if (!this.isDrawing || this.currentTool !== "PEN" || !this.currentGraphics) return;

        this.currentPath.push(new Point(localPos.x, localPos.y));

        this.currentGraphics.clear();
        this.currentGraphics.lineStyle(this.brushSize, this.brushColor, 1);

        if (this.currentPath.length > 0) {
            this.currentGraphics.moveTo(this.currentPath[0].x, this.currentPath[0].y);
            for (let i = 1; i < this.currentPath.length; i++) {
                this.currentGraphics.lineTo(this.currentPath[i].x, this.currentPath[i].y);
            }
        }
    }

    private onPointerUp(e: FederatedPointerEvent) {
        if (!this.isPluginActive) return;

        if (this.isSelecting && this.selectionStart && this.selectionGraphics) {
            this.isSelecting = false;

            const selBounds = this.selectionGraphics.getBounds();

            for (const child of this.memoContainer.children) {
                if (child === this.selectionGraphics) continue;
                if ((child as any).memoId) {
                    const cb = child.getBounds();
                    // Intersect check using global bounds
                    if (cb.x < selBounds.x + selBounds.width &&
                        cb.x + cb.width > selBounds.x &&
                        cb.y < selBounds.y + selBounds.height &&
                        cb.y + cb.height > selBounds.y) {
                        this.selectElement(child as Container, true);
                    }
                }
            }

            this.memoContainer.removeChild(this.selectionGraphics);
            this.selectionGraphics = null;
            return;
        }

        if (!this.isDrawing || this.currentTool !== "PEN") return;
        this.isDrawing = false;

        let finalPath = this.currentPath;

        if (this.currentPath.length === 1) {
            finalPath = [];
            const p = this.currentPath[0];
            for (let i = 0; i <= 8; i++) {
                finalPath.push(new Point(p.x + Math.cos(i * Math.PI / 4) * this.brushSize / 2, p.y + Math.sin(i * Math.PI / 4) * this.brushSize / 2));
            }
        }

        if (this.currentGraphics) {
            this.memoContainer.removeChild(this.currentGraphics);
            this.currentGraphics = null;
        }

        if (finalPath.length > 0) {
            const newMemo: MemoData = {
                id: Date.now().toString() + Math.random().toString(),
                type: "PEN",
                x: 0,
                y: 0,
                path: finalPath.map(p => ({ x: p.x, y: p.y })),
                color: this.brushColor,
                size: this.brushSize
            };
            this.commitMemos([...this.memos, newMemo]);
        }

        this.currentPath = [];
    }

    private createStickyNote(x: number, y: number) {
        const textStr = prompt("Enter text:", "New Note");
        if (textStr === null) return; // Cancelled

        const newMemo: MemoData = {
            id: Date.now().toString() + Math.random().toString(),
            type: "STICKY",
            x: x,
            y: y,
            text: textStr || " "
        };
        this.commitMemos([...this.memos, newMemo]);
    }

    private createFloatingText(x: number, y: number) {
        const textStr = prompt("Enter text:");
        if (!textStr) return;

        const newMemo: MemoData = {
            id: Date.now().toString() + Math.random().toString(),
            type: "TEXT",
            x: x,
            y: y,
            text: textStr,
            font: this.textFont,
            size: this.textSize,
            color: this.textColor
        };
        this.commitMemos([...this.memos, newMemo]);
    }

    private renderSticky(memo: MemoData) {
        const sticky = new Container();
        sticky.x = memo.x;
        sticky.y = memo.y;
        (sticky as any).memoId = memo.id;

        const bg = new Graphics();
        bg.beginFill(0xFFF176);
        bg.drawRect(0, 0, 150, 100);
        bg.endFill();
        bg.lineStyle(1, 0x999999);
        bg.drawRect(0, 0, 150, 100);

        const text = new Text(memo.text || " ", {
            fontFamily: "Arial",
            fontSize: 14,
            fill: 0x000000,
            wordWrap: true,
            wordWrapWidth: 140
        });
        text.x = 5;
        text.y = 5;

        sticky.addChild(bg);
        sticky.addChild(text);

        sticky.eventMode = 'static';
        sticky.cursor = 'move';

        this.addDragLogic(sticky, memo);
        this.addEditLogic(sticky, text, true, memo);

        this.memoContainer.addChild(sticky);
    }

    private renderText(memo: MemoData) {
        const text = new Text(memo.text || " ", {
            fontFamily: memo.font || "Arial",
            fontSize: memo.size || 16,
            fill: memo.color ?? 0xFFFFFF,
            stroke: 0x000000,
            strokeThickness: (memo.color === 0x000000) ? 0 : 1
        });
        text.x = memo.x;
        text.y = memo.y;
        (text as any).memoId = memo.id;

        text.eventMode = 'static';
        text.cursor = 'move';

        this.addDragLogic(text, memo);
        this.addEditLogic(text, text, false, memo);

        this.memoContainer.addChild(text);
    }

    private renderPen(memo: MemoData) {
        if (!memo.path || memo.path.length === 0) return;

        const graphics = new Graphics();
        graphics.x = memo.x || 0;
        graphics.y = memo.y || 0;
        (graphics as any).memoId = memo.id;

        graphics.lineStyle(memo.size || 4, memo.color ?? 0xFFFF00, 1);

        graphics.moveTo(memo.path[0].x, memo.path[0].y);
        for (let i = 1; i < memo.path.length; i++) {
            graphics.lineTo(memo.path[i].x, memo.path[i].y);
        }

        graphics.eventMode = 'static';
        graphics.cursor = 'pointer';

        // Ensure the graphics path can actually be clicked easily by using its bounding box as a hit Area
        graphics.hitArea = graphics.getLocalBounds();

        this.addDragLogic(graphics, memo);

        this.memoContainer.addChild(graphics);
    }

    private selectElement(obj: Container | null, add: boolean = false) {
        if (!add) {
            this.selectedElements.forEach(el => el.alpha = 1.0);
            this.selectedElements.clear();
        }
        if (obj) {
            this.selectedElements.add(obj);
            obj.alpha = 0.5;
        }
    }

    private addDragLogic(obj: Container, memo: MemoData) {
        let dragging = false;
        let startEvPos = { x: 0, y: 0 };
        let startPositions: Map<string, { x: number, y: number }> = new Map();

        obj.on('pointerdown', (ev) => {
            const nativeTarget = ev.nativeEvent?.target as HTMLElement;
            if (nativeTarget && nativeTarget.tagName && nativeTarget.tagName.toUpperCase() !== 'CANVAS') {
                return;
            }

            if (this.currentTool === "ERASER") {
                const newMemos = this.memos.filter(m => m.id !== memo.id);
                this.commitMemos(newMemos);
                ev.stopPropagation();
                return;
            }

            // PENツールの場合はドラッグや選択を行わず、背後のキャンバスにクリック判定を流す（描画を優先する）
            if (this.currentTool === "PEN") {
                return;
            }

            // Allow left click to drag existing selected elements or select new ones
            if (ev.button !== 0) return;

            if (!this.selectedElements.has(obj)) {
                this.selectElement(obj, false);
            }

            dragging = true;
            const loc = this.memoContainer.toLocal(ev.global);
            startEvPos = { x: loc.x, y: loc.y };

            startPositions.clear();
            for (const el of this.selectedElements) {
                startPositions.set((el as any).memoId, { x: el.x, y: el.y });
            }

            ev.stopPropagation();
        });

        const onUp = () => {
            if (dragging) {
                dragging = false;
                let changed = false;
                let newMemos = [...this.memos];

                for (const el of this.selectedElements) {
                    const sp = startPositions.get((el as any).memoId);
                    if (sp && (el.x !== sp.x || el.y !== sp.y)) {
                        changed = true;
                        newMemos = newMemos.map(m => m.id === (el as any).memoId ? { ...m, x: el.x, y: el.y } : m);
                    }
                }

                if (changed) {
                    this.commitMemos(newMemos);
                }
            }
        };

        obj.on('pointerup', onUp);
        obj.on('pointerupoutside', onUp);

        obj.on('pointermove', (ev) => {
            if (dragging) {
                const loc = this.memoContainer.toLocal(ev.global);
                const dx = loc.x - startEvPos.x;
                const dy = loc.y - startEvPos.y;

                for (const el of this.selectedElements) {
                    const sp = startPositions.get((el as any).memoId);
                    if (sp) {
                        el.position.set(sp.x + dx, sp.y + dy);
                    }
                }
            }
        });
    }

    private addEditLogic(container: Container, textObj: Text, hasEditButton: boolean, memo: MemoData) {
        let lastClickTime = 0;

        const editAction = () => {
            const newStr = prompt("Edit text:", textObj.text);
            if (newStr !== null) {
                const newMemos = this.memos.map(m => m.id === memo.id ? { ...m, text: newStr } : m);
                this.commitMemos(newMemos);
            }
        };

        container.on('pointerdown', (ev) => {
            if (ev.button !== 0) return; // Only process left double-click
            const now = Date.now();
            if (now - lastClickTime < 300) {
                editAction();
            }
            lastClickTime = now;
        });

        // Right click to edit (legacy)
        container.on('rightclick', (ev) => {
            editAction();
            ev.stopPropagation();
        });

        if (hasEditButton) {
            const editBtn = new Text("✎", { fontSize: 12 });
            editBtn.x = 130;
            editBtn.y = 5;
            editBtn.eventMode = 'static';
            editBtn.cursor = 'pointer';
            editBtn.on('pointerdown', (ev) => {
                ev.stopPropagation();
                editAction();
            });
            container.addChild(editBtn);
        }
    }
}
