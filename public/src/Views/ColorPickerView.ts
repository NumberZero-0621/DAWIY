import { hsvToRgb, rgbToHex, hexToRgb, rgbToHsv } from "../Utils/Color";

/**
 * カラーピッカービュー
 * ドーナツ型の色相セレクターと、内部の四角形による彩度・明度セレクターを提供する
 */
export default class ColorPickerView {
    private container: HTMLDivElement;
    private canvas: HTMLCanvasElement;
    private ctx: CanvasRenderingContext2D;

    private currentHex: string = "#FF0000";
    private h: number = 0; // 0-360
    private s: number = 1; // 0-1
    private v: number = 1; // 0-1

    private size: number = 200;
    private ringThickness: number = 20;
    private innerPadding: number = 15;

    // Dragging states
    private isDraggingRing: boolean = false;
    private isDraggingSquare: boolean = false;

    private onColorChange: ((color: string) => void) | null = null;
    private onClose: (() => void) | null = null;

    constructor() {
        this.container = document.createElement("div");
        this.container.style.position = "fixed";
        this.container.style.zIndex = "10000";
        this.container.style.backgroundColor = "#2c2c2c";
        this.container.style.borderRadius = "50%";
        this.container.style.boxShadow = "0 0 10px rgba(0,0,0,0.5)";
        this.container.style.width = `${this.size}px`;
        this.container.style.height = `${this.size}px`;
        this.container.style.display = "none";
        // Prevent selection
        this.container.style.userSelect = "none";

        this.canvas = document.createElement("canvas");
        this.canvas.width = this.size;
        this.canvas.height = this.size;
        this.canvas.style.borderRadius = "50%";
        this.canvas.style.cursor = "crosshair";

        this.ctx = this.canvas.getContext("2d")!;

        this.container.appendChild(this.canvas);
        document.body.appendChild(this.container);

        this.bindEvents();
    }

    public show(x: number, y: number, initialColor: string, onColorChange: (color: string) => void, onClose?: () => void) {
        this.currentHex = initialColor;
        this.onColorChange = onColorChange;
        this.onClose = onClose || null;

        // Parse initial color
        const rgb = hexToRgb(initialColor);
        if (rgb) {
            const hsv = rgbToHsv(rgb.r, rgb.g, rgb.b);
            this.h = hsv.h;
            this.s = hsv.s;
            this.v = hsv.v;
        }

        // Position adjustment to keep inside valid area
        const windowWidth = window.innerWidth;
        const windowHeight = window.innerHeight;

        if (x + this.size > windowWidth) x = windowWidth - this.size - 10;
        if (y + this.size > windowHeight) y = windowHeight - this.size - 10;
        if (x < 0) x = 10;
        if (y < 0) y = 10;

        this.container.style.left = `${x}px`;
        this.container.style.top = `${y}px`;
        this.container.style.display = "block";

        this.draw();

        // Add global click listener to close when clicking outside
        setTimeout(() => {
            document.addEventListener("mousedown", this.handleGlobalClick);
        }, 0);
    }

    public close() {
        this.container.style.display = "none";
        this.onColorChange = null;
        if (this.onClose) this.onClose();
        document.removeEventListener("mousedown", this.handleGlobalClick);
    }

    private handleGlobalClick = (e: MouseEvent) => {
        if (!this.container.contains(e.target as Node)) {
            this.close();
        }
    }

    private bindEvents() {
        const getHVFromEvent = (e: MouseEvent | TouchEvent) => {
            const rect = this.canvas.getBoundingClientRect();
            let clientX, clientY;
            if (e instanceof MouseEvent) {
                clientX = e.clientX;
                clientY = e.clientY;
            } else {
                clientX = e.touches[0].clientX;
                clientY = e.touches[0].clientY;
            }
            return {
                x: clientX - rect.left,
                y: clientY - rect.top
            };
        };

        const handleStart = (e: MouseEvent | TouchEvent) => {
            const pos = getHVFromEvent(e);
            const cx = this.size / 2;
            const cy = this.size / 2;
            const dx = pos.x - cx;
            const dy = pos.y - cy;
            const dist = Math.sqrt(dx * dx + dy * dy);

            // Outer ring check
            if (dist > this.size / 2 - this.ringThickness && dist < this.size / 2) {
                this.isDraggingRing = true;
                this.updateHue(dx, dy);
            }
            // Inner square check (approximate)
            else if (dist < this.size / 2 - this.ringThickness - this.innerPadding) {
                this.isDraggingSquare = true;
                this.updateSV(pos.x, pos.y);
            }
        };

        const handleMove = (e: MouseEvent | TouchEvent) => {
            if (this.isDraggingRing) {
                e.preventDefault();
                const pos = getHVFromEvent(e);
                const cx = this.size / 2;
                const cy = this.size / 2;
                this.updateHue(pos.x - cx, pos.y - cy);
            } else if (this.isDraggingSquare) {
                e.preventDefault();
                const pos = getHVFromEvent(e);
                this.updateSV(pos.x, pos.y);
            }
        };

        const handleEnd = () => {
            this.isDraggingRing = false;
            this.isDraggingSquare = false;
        };

        this.canvas.addEventListener("mousedown", handleStart);
        document.addEventListener("mousemove", handleMove);
        document.addEventListener("mouseup", handleEnd);
    }

    private updateHue(dx: number, dy: number) {
        let angle = Math.atan2(dy, dx) * (180 / Math.PI);
        if (angle < 0) angle += 360;
        this.h = angle;
        this.emitChange();
        this.draw();
    }

    private updateSV(x: number, y: number) {
        // Inner square area defined in draw()
        // Here we map click position to S and V
        // Square width derived from geometry inside circle
        const cx = this.size / 2;
        const cy = this.size / 2;
        const innerRadius = this.size / 2 - this.ringThickness - this.innerPadding;
        const squareSize = innerRadius * Math.sqrt(2); // Biggest square fitting in circle
        const halfSquare = squareSize / 2;

        const localX = x - cx; // relative to center
        const localY = y - cy;

        // Clamp to square
        const clampedX = Math.max(-halfSquare, Math.min(halfSquare, localX));
        const clampedY = Math.max(-halfSquare, Math.min(halfSquare, localY));

        // Map to S (x-axis) and V (y-axis)
        // S: left(0) -> right(1)
        // V: bottom(0) -> top(1) -> actually usually top is 1 (bright) and bottom is 0 (dark)

        this.s = (clampedX + halfSquare) / squareSize;
        this.v = 1 - ((clampedY + halfSquare) / squareSize);

        this.emitChange();
        this.draw();
    }

    private emitChange() {
        const rgb = hsvToRgb(this.h, this.s, this.v);
        this.currentHex = rgbToHex(rgb.r, rgb.g, rgb.b);
        if (this.onColorChange) {
            this.onColorChange(this.currentHex);
        }
    }

    private draw() {
        const cx = this.size / 2;
        const cy = this.size / 2;
        const radius = this.size / 2;

        this.ctx.clearRect(0, 0, this.size, this.size);

        // 1. Draw Hue Ring
        for (let i = 0; i < 360; i++) {
            const startAngle = (i - 90) * Math.PI / 180;
            const endAngle = (i + 1.5 - 90) * Math.PI / 180;
            this.ctx.beginPath();
            this.ctx.arc(cx, cy, radius - this.ringThickness / 2, startAngle, endAngle);
            this.ctx.lineWidth = this.ringThickness;
            this.ctx.strokeStyle = `hsl(${i}, 100%, 50%)`;
            this.ctx.stroke();
        }

        // Hue Indicator
        const hueAngleRad = (this.h - 90) * Math.PI / 180; // Correct angle (0 is right, but hue wheel usually starts top?)
        // Actually atan2(dy, dx) returns 0 for right.
        // My Hue Loop starts at -90 (top). 
        // Let's align them.
        // updateHue calculates angle from right (0), ccw is negative? No, atan2 is standard. 
        // 0 is Right, 90 is Bottom. 
        // HSL hue: 0 Red, 120 Green, 240 Blue.
        // Standard color wheel: Red at top or right? usually Red at Top (0deg).
        // Let's stick to standard angle from center. 0 = Right = Red.

        // Re-drawing Hue Ring to match atan2 (0=Right)
        this.ctx.clearRect(0, 0, this.size, this.size);
        for (let i = 0; i < 360; i++) {
            const rad = i * Math.PI / 180;
            this.ctx.beginPath();
            this.ctx.arc(cx, cy, radius - this.ringThickness / 2, rad, rad + 0.02); // Small steps
            this.ctx.lineWidth = this.ringThickness;
            this.ctx.strokeStyle = `hsl(${i}, 100%, 50%)`;
            this.ctx.stroke();
        }

        // Draw Hue Highlight
        const hRad = this.h * Math.PI / 180;
        const hIndicatorX = cx + (radius - this.ringThickness / 2) * Math.cos(hRad);
        const hIndicatorY = cy + (radius - this.ringThickness / 2) * Math.sin(hRad);

        this.ctx.beginPath();
        this.ctx.arc(hIndicatorX, hIndicatorY, this.ringThickness / 2 - 2, 0, Math.PI * 2);
        this.ctx.strokeStyle = "white";
        this.ctx.lineWidth = 2;
        this.ctx.stroke();
        this.ctx.fillStyle = `hsl(${this.h}, 100%, 50%)`;
        this.ctx.fill();

        // 2. Draw SV Square
        const innerRadius = this.size / 2 - this.ringThickness - this.innerPadding;
        const squareSize = innerRadius * Math.sqrt(2);
        const halfSquare = squareSize / 2;
        const sqX = cx - halfSquare;
        const sqY = cy - halfSquare;

        // Create Gradients for SV Square
        // Horizontal: White to Pure Color (Saturation)
        const gradH = this.ctx.createLinearGradient(sqX, 0, sqX + squareSize, 0);
        gradH.addColorStop(0, "white");
        gradH.addColorStop(1, `hsl(${this.h}, 100%, 50%)`);

        this.ctx.fillStyle = gradH;
        this.ctx.fillRect(sqX, sqY, squareSize, squareSize);

        // Vertical: Transparent to Black (Value/Brightness)
        // Top is bright (transparent), Bottom is dark (black)?
        // Wait, standard SV picker:
        // Top-Left: White (S=0,V=1) | Top-Right: Color (S=1,V=1)
        // Bottom-Left: Black (S=0,V=0)| Bottom-Right: Black (S=1,V=0)
        // So vertical gradient should be Transparent (Top) to Black (Bottom).

        const gradV = this.ctx.createLinearGradient(0, sqY, 0, sqY + squareSize);
        gradV.addColorStop(0, "rgba(0,0,0,0)");
        gradV.addColorStop(1, "rgba(0,0,0,1)");

        this.ctx.fillStyle = gradV;
        this.ctx.fillRect(sqX, sqY, squareSize, squareSize);

        // SV Indicator
        // s = (x - sqX) / w  => x = s*w + sqX
        // v = 1 - (y - sqY) / h => y = sqY + (1-v)*h
        const indX = sqX + this.s * squareSize;
        const indY = sqY + (1 - this.v) * squareSize;

        this.ctx.beginPath();
        this.ctx.arc(indX, indY, 4, 0, Math.PI * 2);
        this.ctx.strokeStyle = this.v > 0.5 ? "black" : "white";
        this.ctx.lineWidth = 2;
        this.ctx.stroke();
        this.ctx.fillStyle = this.currentHex;
        this.ctx.fill();
    }
}
