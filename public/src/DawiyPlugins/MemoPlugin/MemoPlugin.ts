import { Application, Container, Graphics, FederatedPointerEvent, Text, Point, IPointData } from "pixi.js";
import App from "../../App";
import { DAWIYPlugin } from "../IDawiyPlugin";
import DawiyPluginBase from "../DawiyPluginBase";

type ToolType = "PEN" | "ERASER" | "STICKY" | "TEXT";

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
    private isDrawing = false;
    private currentTool: ToolType = "PEN";
    private brushColor = 0xFFFF00;
    private brushSize = 4;
    private isPluginActive = false;

    // Sticky
    private stickyCounter = 0;

    constructor(app: App) {
        super(app);
        this.memoContainer = new Container();
        this.memoContainer.zIndex = 200; // Above regions (usually < 100) and selection box (100)
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
            sizeInput.max = "20";
            sizeInput.value = this.brushSize.toString();
            sizeInput.style.width = "40px";
            sizeInput.oninput = () => {
                this.brushSize = parseInt(sizeInput.value);
            };
            sizeRow.appendChild(sizeLabel);
            sizeRow.appendChild(sizeInput);
            container.appendChild(sizeRow);
        } else if (this.currentTool === "ERASER") {
            const clearBtn = document.createElement("button");
            clearBtn.textContent = "Clear All Memos";
            clearBtn.style.padding = "5px";
            clearBtn.style.background = "#D32F2F";
            clearBtn.style.color = "white";
            clearBtn.style.border = "none";
            clearBtn.style.cursor = "pointer";
            clearBtn.onclick = () => {
                if (confirm("Clear all drawings and notes?")) {
                    this.memoContainer.removeChildren();
                }
            };
            container.appendChild(clearBtn);
        }
    }

    public override onActivate() {
        this.activateOverlay();
    }

    public override onDeactivate() {
        this.deactivateOverlay();
    }

    private activateOverlay() {
        if (this.isPluginActive) return;
        this.isPluginActive = true;

        // Add container to viewport
        this.app.editorView.viewport.addChild(this.memoContainer);

        // Bind events
        this.app.editorView.viewport.on("pointerdown", this.onPointerDown, this);
        this.app.editorView.viewport.on("pointermove", this.onPointerMove, this);
        this.app.editorView.viewport.on("pointerup", this.onPointerUp, this);
        this.app.editorView.viewport.on("pointerupoutside", this.onPointerUp, this);

        // Disable regular editor interaction if needed?
        // Actually, we probably want to allow zooming/panning with middle/right click or modifiers,
        // but capture left click for drawing if Pen tool is active.

        // We might need to handle event propagation carefully.
        this.memoContainer.eventMode = 'static';
    }

    private deactivateOverlay() {
        if (!this.isPluginActive) return;
        this.isPluginActive = false;

        // Note: We DO NOT remove the child from viewport, because we want the memos to PERSIST visually
        // even when the plugin tab is closed, OR? 
        // User request: "Memo on track editing screen". 
        // Typically, if I close the plugin panel, the tool is inactive, but should the memos disappear?
        // Let's assume they should stay visible.

        // HOWEVER, we MUST unbind the listeners so we don't draw when plugin is closed.
        this.app.editorView.viewport.off("pointerdown", this.onPointerDown, this);
        this.app.editorView.viewport.off("pointermove", this.onPointerMove, this);
        this.app.editorView.viewport.off("pointerup", this.onPointerUp, this);
        this.app.editorView.viewport.off("pointerupoutside", this.onPointerUp, this);
    }

    private lastPoint: Point = new Point();

    private onPointerDown(e: FederatedPointerEvent) {
        if (!this.isPluginActive) return;
        // Check if left click
        if (e.button !== 0) return;

        const localPos = this.memoContainer.toLocal(e.global);

        if (this.currentTool === "PEN") {
            // Pen (Colored Text)
            this.createColoredText(localPos.x, localPos.y);
            e.stopPropagation();
        } else if (this.currentTool === "STICKY") {
            this.createStickyNote(localPos.x, localPos.y);
            e.stopPropagation();
        } else if (this.currentTool === "TEXT") {
            this.createFloatingText(localPos.x, localPos.y);
            e.stopPropagation();
        }
    }

    private onPointerMove(e: FederatedPointerEvent) {
        // No longer needed for drawing
    }

    private onPointerUp(e: FederatedPointerEvent) {
        // No longer needed for drawing
    }

    private createStickyNote(x: number, y: number) {
        const textStr = prompt("Enter text:", "New Note");
        if (textStr === null) return; // Cancelled

        const sticky = new Container();
        sticky.x = x;
        sticky.y = y;

        const bg = new Graphics();
        bg.beginFill(0xFFF176);
        bg.drawRect(0, 0, 150, 100);
        bg.endFill();
        // Shadow/Border
        bg.lineStyle(1, 0x999999);
        bg.drawRect(0, 0, 150, 100);

        const text = new Text(textStr || " ", {
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

        this.addDragLogic(sticky);
        this.addEditLogic(sticky, text, true);

        this.memoContainer.addChild(sticky);
    }

    private createFloatingText(x: number, y: number) {
        const textStr = prompt("Enter text:");
        if (!textStr) return;

        const text = new Text(textStr, {
            fontFamily: "Arial",
            fontSize: 16,
            fill: 0xFFFFFF,
            stroke: 0x000000,
            strokeThickness: 2
        });
        text.x = x;
        text.y = y;

        text.eventMode = 'static';
        text.cursor = 'move';

        this.addDragLogic(text);
        this.addEditLogic(text, text, false);

        this.memoContainer.addChild(text);
    }

    private createColoredText(x: number, y: number) {
        const textStr = prompt("Enter text:");
        if (!textStr) return;

        const fontSize = 10 + (this.brushSize * 2);

        const text = new Text(textStr, {
            fontFamily: "Arial",
            fontSize: fontSize,
            fill: this.brushColor,
            stroke: 0xFFFFFF,
            strokeThickness: 1 // Slight outline for visibility?
        });
        text.x = x;
        text.y = y;

        text.eventMode = 'static';
        text.cursor = 'move';

        this.addDragLogic(text);
        this.addEditLogic(text, text, false);

        this.memoContainer.addChild(text);
    }

    private addDragLogic(obj: Container) {
        let dragging = false;
        let offset = { x: 0, y: 0 };

        obj.on('pointerdown', (ev) => {
            if (this.currentTool === "ERASER") {
                this.memoContainer.removeChild(obj);
                ev.stopPropagation();
                return;
            }
            dragging = true;
            obj.alpha = 0.7;
            const loc = obj.toLocal(ev.global);
            offset.x = loc.x * obj.scale.x;
            offset.y = loc.y * obj.scale.y;
            ev.stopPropagation();
        });

        obj.on('pointerup', () => {
            dragging = false;
            obj.alpha = 1;
        });
        obj.on('pointerupoutside', () => {
            dragging = false;
            obj.alpha = 1;
        });

        obj.on('pointermove', (ev) => {
            if (dragging) {
                const newPos = this.memoContainer.toLocal(ev.global);
                obj.position.set(newPos.x - offset.x, newPos.y - offset.y);
            }
        });
    }

    private addEditLogic(container: Container, textObj: Text, hasEditButton: boolean) {
        // Right click to edit
        container.on('rightclick', (ev) => {
            const newStr = prompt("Edit text:", textObj.text);
            if (newStr !== null) textObj.text = newStr;
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
                const newText = prompt("Edit Note:", textObj.text);
                if (newText !== null) textObj.text = newText;
            });
            container.addChild(editBtn);
        }
    }
}
