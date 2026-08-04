import { MazeSolver, TerrainType, AlgorithmType, TERRAIN_NAMES } from "./MazeSolver";

export type ToolType = 'plain' | 'forest' | 'bridge' | 'wall' | 'start' | 'goal';
export type SeqMode = 'melody' | 'drum';

export interface UIState {
    algo: AlgorithmType;
    mode: SeqMode;
    tool: ToolType;
    allowDiagonals: boolean;
    autoGenerate: boolean;
    stepDuration: string; // "1/16", "1/8", "1/4", "1/32"
    scale: string;
    basePitch: number;
}

export interface UIEventCallbacks {
    onGenerate: () => void;
    onStateChange: () => void;
}

const SCALE_NOTES: Record<string, number[]> = {
    "Major": [0, 2, 4, 5, 7, 9, 11],
    "Minor": [0, 2, 3, 5, 7, 8, 10],
    "Pentatonic Major": [0, 2, 4, 7, 9],
    "Pentatonic Minor": [0, 3, 5, 7, 10],
    "Blues": [0, 3, 5, 6, 7, 10],
    "Dorian": [0, 2, 3, 5, 7, 9, 10],
    "Mixolydian": [0, 2, 4, 5, 7, 9, 10]
};

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

const DRUM_NAMES = [
    { name: "Kick (C2)", pitch: 36 },
    { name: "Snare (D2)", pitch: 38 },
    { name: "Clap (D#2)", pitch: 39 },
    { name: "Closed HiHat (F#2)", pitch: 42 },
    { name: "Tom (A2)", pitch: 45 },
    { name: "Open HiHat (A#2)", pitch: 46 },
    { name: "Crash (C#3)", pitch: 49 },
    { name: "Ride (D#3)", pitch: 51 }
];

export class MazeUI {
    private container: HTMLElement;
    private solver: MazeSolver;
    private state: UIState;
    private callbacks: UIEventCallbacks;
    private isMouseDown = false;
    private gridElements: HTMLElement[][] = [];
    private statsEl: HTMLElement | null = null;
    private academicMemoEl: HTMLElement | null = null;
    private gridContainerEl: HTMLElement | null = null;

    constructor(container: HTMLElement, solver: MazeSolver, initialState: UIState, callbacks: UIEventCallbacks) {
        this.container = container;
        this.solver = solver;
        this.state = initialState;
        this.callbacks = callbacks;

        // Bind global mouseup to stop dragging
        window.addEventListener('mouseup', () => {
            if (this.isMouseDown) {
                this.isMouseDown = false;
                if (this.state.autoGenerate) {
                    this.callbacks.onGenerate();
                }
            }
        });
    }

    public render(): void {
        this.container.innerHTML = '';
        this.container.style.color = "#ecf0f1";
        this.container.style.padding = "12px";
        this.container.style.display = "flex";
        this.container.style.flexDirection = "column";
        this.container.style.gap = "14px";
        this.container.style.fontFamily = "'Inter', 'Segoe UI', sans-serif";
        this.container.style.backgroundColor = "#121820";
        this.container.style.borderRadius = "8px";
        this.container.style.boxShadow = "0 4px 20px rgba(0,0,0,0.5)";
        this.container.style.overflowY = "auto";
        this.container.style.maxHeight = "100%";

        this.injectScopedStyles();

        // Title Area
        const header = document.createElement("div");
        header.className = "astar-header";
        header.innerHTML = `
            <div class="astar-title-row">
                <h2 class="astar-title">A* 迷路シーケンサー (A* Maze Sequencer)</h2>
                <span class="astar-badge">GENERATOR PLUGIN</span>
            </div>
            <p class="astar-desc">グリッド上の地形と障害物を探索アルゴリズムが解析し、最短経路を音楽フレーズ（メロディ／リズムパターン）としてDAWトラックに自動生成します。</p>
        `;
        this.container.appendChild(header);

        // Controls Row 1: Algorithm & Mode
        const ctrlRow1 = document.createElement("div");
        ctrlRow1.className = "astar-panel";
        this.buildAlgorithmControls(ctrlRow1);
        this.container.appendChild(ctrlRow1);

        // Controls Row 2: Drawing Tools & Presets
        const ctrlRow2 = document.createElement("div");
        ctrlRow2.className = "astar-panel";
        this.buildToolControls(ctrlRow2);
        this.container.appendChild(ctrlRow2);

        // Grid Area (with Y-axis labels)
        const gridContainer = document.createElement("div");
        gridContainer.className = "astar-grid-wrapper";
        this.gridContainerEl = gridContainer;
        this.buildGrid(gridContainer);
        this.container.appendChild(gridContainer);

        // Stats & Analysis Area
        const statsPanel = document.createElement("div");
        statsPanel.className = "astar-panel astar-stats-panel";
        this.buildStatsPanel(statsPanel);
        this.container.appendChild(statsPanel);

        // Generate Action Bar
        const actionBar = document.createElement("div");
        actionBar.className = "astar-action-bar";
        this.buildActionBar(actionBar);
        this.container.appendChild(actionBar);

        // Initial update
        this.updateVisualization();
    }

    public getState(): UIState {
        return { ...this.state };
    }

    public updateVisualization(): void {
        const result = this.solver.solve(this.state.algo, this.state.allowDiagonals);

        const exploredSet = new Set<string>();
        const exploredOrderMap = new Map<string, number>();
        result.explored.forEach((p, idx) => {
            const k = `${p.x},${p.y}`;
            exploredSet.add(k);
            exploredOrderMap.set(k, idx + 1);
        });

        const pathSet = new Set<string>();
        const pathOrderMap = new Map<string, number>();
        result.path.forEach((p, idx) => {
            const k = `${p.x},${p.y}`;
            pathSet.add(k);
            pathOrderMap.set(k, idx + 1);
        });

        const start = this.solver.getStart();
        const goal = this.solver.getGoal();

        for (let x = 0; x < this.solver.getCols(); x++) {
            for (let y = 0; y < this.solver.getRows(); y++) {
                const el = this.gridElements[x]?.[y];
                if (!el) continue;

                const k = `${x},${y}`;
                const terrain = this.solver.getTerrain(x, y);

                // Reset classes
                el.className = `astar-cell terrain-${terrain}`;
                el.innerHTML = '';

                // Start / Goal override
                if (x === start.x && y === start.y) {
                    el.classList.add('cell-start');
                    el.textContent = 'S';
                } else if (x === goal.x && y === goal.y) {
                    el.classList.add('cell-goal');
                    el.textContent = 'G';
                } else {
                    // Explored overlay
                    if (exploredSet.has(k)) {
                        el.classList.add('cell-explored');
                    }
                    // Path overlay
                    if (pathSet.has(k)) {
                        el.classList.add('cell-path');
                        const stepNum = document.createElement("span");
                        stepNum.className = "astar-step-num";
                        stepNum.textContent = `${pathOrderMap.get(k)}`;
                        el.appendChild(stepNum);
                    }
                }
            }
        }

        // Update stats
        this.updateStatsText(result.exploredCount, result.pathLength, result.totalCost, result.success);
    }

    public getPitchForRow(y: number): number {
        const rows = this.solver.getRows();
        // Invert Y so bottom row is lowest pitch, top row is highest pitch
        const invertedY = (rows - 1) - y;

        if (this.state.mode === 'drum') {
            const drumIdx = invertedY % DRUM_NAMES.length;
            return DRUM_NAMES[drumIdx].pitch;
        } else {
            const scaleOffsets = SCALE_NOTES[this.state.scale] || SCALE_NOTES["Major"];
            const scaleLen = scaleOffsets.length || 1;
            const octaveOffset = Math.floor(invertedY / scaleLen) * 12;
            const noteInScale = scaleOffsets[invertedY % scaleLen];
            return this.state.basePitch + octaveOffset + noteInScale;
        }
    }

    public getRowLabel(y: number): string {
        const rows = this.solver.getRows();
        const invertedY = (rows - 1) - y;

        if (this.state.mode === 'drum') {
            const drumIdx = invertedY % DRUM_NAMES.length;
            return DRUM_NAMES[drumIdx].name;
        } else {
            const pitch = this.getPitchForRow(y);
            const noteName = NOTE_NAMES[pitch % 12];
            const octave = Math.floor(pitch / 12) - 1;
            return `${noteName}${octave}`;
        }
    }

    private injectScopedStyles(): void {
        const styleId = "astar-maze-scoped-styles";
        if (document.getElementById(styleId)) {
            // Remove existing style to allow live reloading of style changes
            document.getElementById(styleId)?.remove();
        }

        const style = document.createElement("style");
        style.id = styleId;
        style.textContent = `
            .astar-header { border-bottom: 1px solid #2a3441; padding-bottom: 10px; flex-shrink: 0; }
            .astar-title-row { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px; }
            .astar-title { margin: 0; font-size: 1.25rem; font-weight: 700; color: #61dafb; }
            .astar-badge { background: linear-gradient(135deg, #2b6cb0, #3182ce); color: #fff; padding: 3px 8px; border-radius: 12px; font-size: 0.75rem; font-weight: bold; text-transform: uppercase; letter-spacing: 0.5px; }
            .astar-desc { margin: 6px 0 0 0; font-size: 0.85rem; color: #a0aec0; line-height: 1.4; }

            .astar-panel { background: #1a222d; border: 1px solid #2d3748; border-radius: 6px; padding: 10px 12px; display: flex; flex-direction: column; gap: 8px; flex-shrink: 0; }
            .astar-row { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; }
            .astar-label { font-size: 0.85rem; font-weight: 600; color: #cbd5e0; display: flex; align-items: center; gap: 6px; }
            
            .astar-select, .astar-btn { background: #2d3748; color: #fff; border: 1px solid #4a5568; padding: 6px 10px; border-radius: 4px; font-size: 0.85rem; cursor: pointer; transition: all 0.2s; }
            .astar-select:hover, .astar-btn:hover { background: #4a5568; border-color: #718096; }
            .astar-btn.active { box-shadow: 0 0 0 2px #fff, 0 0 12px rgba(97,218,251,0.8) !important; font-weight: 800; transform: scale(1.05); z-index: 2; }
            .astar-btn-preset { background: #2b6cb0; border-color: #3182ce; }
            .astar-btn-preset:hover { background: #3182ce; }

            .tool-btn-wall { background-color: #742a2a !important; border-color: #9b2c2c !important; background-image: linear-gradient(45deg, #9b2c2c 25%, transparent 25%, transparent 50%, #9b2c2c 50%, #9b2c2c 75%, transparent 75%, transparent) !important; background-size: 10px 10px !important; text-shadow: 0 1px 2px rgba(0,0,0,0.8); }
            .tool-btn-forest { background-color: #1a4731 !important; border-color: #2f855a !important; background-image: radial-gradient(#38a169 15%, transparent 16%) !important; background-size: 8px 8px !important; text-shadow: 0 1px 2px rgba(0,0,0,0.8); }
            .tool-btn-bridge { background-color: #b7791f !important; border-color: #d69e2e !important; box-shadow: inset 0 0 6px rgba(236,201,75,0.4); text-shadow: 0 1px 2px rgba(0,0,0,0.8); }
            .tool-btn-plain { background-color: #243140 !important; border-color: #324357 !important; }
            .tool-btn-start { background-color: #38a169 !important; border-color: #68d391 !important; color: #fff !important; }
            .tool-btn-goal { background-color: #e53e3e !important; border-color: #fc8181 !important; color: #fff !important; }

            .astar-grid-wrapper { display: flex; gap: 8px; align-items: flex-start; background: #151c25; padding: 12px; border-radius: 6px; border: 1px solid #2d3748; overflow: auto; flex-shrink: 0; min-height: 310px; max-height: 520px; }
            .astar-y-labels { display: flex; flex-direction: column; justify-content: space-around; font-size: 0.75rem; font-weight: bold; color: #a0aec0; padding-right: 6px; border-right: 1px solid #2d3748; min-width: 85px; text-align: right; }
            .astar-grid { display: grid; gap: 2px; background: #0b0f14; padding: 4px; border-radius: 4px; border: 1px solid #1a222d; user-select: none; }
            
            .astar-cell { width: 34px; height: 34px; border-radius: 3px; position: relative; display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 0.8rem; cursor: pointer; transition: transform 0.1s, background-color 0.2s; }
            .astar-cell:hover { transform: scale(1.08); z-index: 2; }
            
            .terrain-plain { background-color: #243140; border: 1px solid #324357; }
            .terrain-forest { background-color: #1a4731; border: 1px solid #2f855a; background-image: radial-gradient(#38a169 15%, transparent 16%); background-size: 8px 8px; }
            .terrain-bridge { background-color: #b7791f; border: 1px solid #d69e2e; box-shadow: inset 0 0 6px rgba(236,201,75,0.4); }
            .terrain-wall { background-color: #742a2a; border: 1px solid #9b2c2c; background-image: linear-gradient(45deg, #9b2c2c 25%, transparent 25%, transparent 50%, #9b2c2c 50%, #9b2c2c 75%, transparent 75%, transparent); background-size: 10px 10px; }
            
            .cell-start { background-color: #38a169 !important; border-color: #68d391 !important; color: #fff; box-shadow: 0 0 12px #38a169; z-index: 3; }
            .cell-goal { background-color: #e53e3e !important; border-color: #fc8181 !important; color: #fff; box-shadow: 0 0 12px #e53e3e; z-index: 3; }
            
            .cell-explored::before { content: ''; position: absolute; inset: 0; background: rgba(66, 153, 225, 0.35); border-radius: 2px; pointer-events: none; }
            .cell-path { background-color: #ecc94b !important; border: 2px solid #fff !important; color: #1a202c !important; box-shadow: 0 0 14px rgba(236,201,75,0.9); z-index: 4; }
            .astar-step-num { font-size: 0.65rem; font-weight: 900; background: rgba(255,255,255,0.85); padding: 1px 4px; border-radius: 8px; color: #000; }

            .astar-stats-panel { background: linear-gradient(135deg, #1a222d, #151c25); border-left: 4px solid #61dafb; }
            .astar-stats-title { font-size: 0.95rem; font-weight: 700; color: #61dafb; margin: 0 0 8px 0; display: flex; align-items: center; gap: 6px; }
            .astar-stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 10px; margin-bottom: 10px; }
            .astar-stat-box { background: #0b0f14; padding: 8px 10px; border-radius: 4px; border: 1px solid #2d3748; }
            .astar-stat-label { font-size: 0.7rem; color: #a0aec0; text-transform: uppercase; margin-bottom: 2px; }
            .astar-stat-val { font-size: 1.1rem; font-weight: 800; color: #fff; }
            .astar-memo { background: #232d3f; border: 1px solid #3182ce; padding: 10px; border-radius: 4px; font-size: 0.8rem; color: #ebf8ff; line-height: 1.5; }

            .astar-action-bar { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px; background: #1a222d; padding: 12px; border-radius: 6px; border: 1px solid #2d3748; flex-shrink: 0; }
            .astar-gen-btn { background: linear-gradient(135deg, #38a169, #2f855a); color: #fff; border: none; padding: 10px 20px; border-radius: 6px; font-size: 1rem; font-weight: 700; cursor: pointer; transition: all 0.2s; box-shadow: 0 4px 12px rgba(56,161,105,0.4); }
            .astar-gen-btn:hover { background: linear-gradient(135deg, #48bb78, #38a169); transform: translateY(-1px); box-shadow: 0 6px 16px rgba(56,161,105,0.6); }
            .astar-toggle-label { display: flex; align-items: center; gap: 8px; font-size: 0.85rem; color: #cbd5e0; cursor: pointer; }
        `;
        document.head.appendChild(style);
    }

    private buildAlgorithmControls(parent: HTMLElement): void {
        const row = document.createElement("div");
        row.className = "astar-row";

        // Algo Select
        const algoLabel = document.createElement("label");
        algoLabel.className = "astar-label";
        algoLabel.innerHTML = `<span>探索アルゴリズム:</span>`;
        const algoSelect = document.createElement("select");
        algoSelect.className = "astar-select";
        const algos = [
            { id: 'astar_manhattan', name: 'A* (マンハッタン距離ヒューリスティクス)' },
            { id: 'astar_euclidean', name: 'A* (ユークリッド距離ヒューリスティクス)' },
            { id: 'dijkstra', name: 'ダイクストラ法 (Dijkstra / ヒューリスティクスなし)' }
        ];
        algos.forEach(a => {
            const opt = document.createElement("option");
            opt.value = a.id;
            opt.textContent = a.name;
            if (a.id === this.state.algo) opt.selected = true;
            algoSelect.appendChild(opt);
        });
        algoSelect.onchange = () => {
            this.state.algo = algoSelect.value as AlgorithmType;
            this.updateVisualization();
            this.callbacks.onStateChange();
            if (this.state.autoGenerate) this.callbacks.onGenerate();
        };
        algoLabel.appendChild(algoSelect);
        row.appendChild(algoLabel);

        // Diagonal Toggle
        const diagLabel = document.createElement("label");
        diagLabel.className = "astar-toggle-label";
        const diagCheckbox = document.createElement("input");
        diagCheckbox.type = "checkbox";
        diagCheckbox.checked = this.state.allowDiagonals;
        diagCheckbox.onchange = () => {
            this.state.allowDiagonals = diagCheckbox.checked;
            this.updateVisualization();
            this.callbacks.onStateChange();
            if (this.state.autoGenerate) this.callbacks.onGenerate();
        };
        diagLabel.appendChild(diagCheckbox);
        diagLabel.append(" 8方向移動 (斜め移動あり)");
        row.appendChild(diagLabel);

        // Mode Select
        const modeLabel = document.createElement("label");
        modeLabel.className = "astar-label";
        modeLabel.style.marginLeft = "auto";
        modeLabel.innerHTML = `<span>音源モード:</span>`;
        const modeSelect = document.createElement("select");
        modeSelect.className = "astar-select";
        const modes = [
            { id: 'melody', name: 'メロディ (スケール音程)' },
            { id: 'drum', name: 'ドラムキット (パーカッション)' }
        ];
        modes.forEach(m => {
            const opt = document.createElement("option");
            opt.value = m.id;
            opt.textContent = m.name;
            if (m.id === this.state.mode) opt.selected = true;
            modeSelect.appendChild(opt);
        });
        modeSelect.onchange = () => {
            this.state.mode = modeSelect.value as SeqMode;
            this.rebuildYLabels();
            this.updateVisualization();
            this.callbacks.onStateChange();
            if (this.state.autoGenerate) this.callbacks.onGenerate();
        };
        modeLabel.appendChild(modeSelect);
        row.appendChild(modeLabel);

        parent.appendChild(row);

        // Sub row for Scale / Step Duration
        const subRow = document.createElement("div");
        subRow.className = "astar-row";
        subRow.style.marginTop = "6px";

        // Scale Select
        const scaleLabel = document.createElement("label");
        scaleLabel.className = "astar-label";
        scaleLabel.innerHTML = `<span>スケール:</span>`;
        const scaleSelect = document.createElement("select");
        scaleSelect.className = "astar-select";
        Object.keys(SCALE_NOTES).forEach(s => {
            const opt = document.createElement("option");
            opt.value = s;
            opt.textContent = s;
            if (s === this.state.scale) opt.selected = true;
            scaleSelect.appendChild(opt);
        });
        scaleSelect.onchange = () => {
            this.state.scale = scaleSelect.value;
            this.rebuildYLabels();
            this.callbacks.onStateChange();
            if (this.state.autoGenerate) this.callbacks.onGenerate();
        };
        scaleLabel.appendChild(scaleSelect);
        subRow.appendChild(scaleLabel);

        // Step Duration Select
        const stepLabel = document.createElement("label");
        stepLabel.className = "astar-label";
        stepLabel.innerHTML = `<span>1ステップの音価:</span>`;
        const stepSelect = document.createElement("select");
        stepSelect.className = "astar-select";
        const steps = [
            { id: '1/32', name: '1/32 (32分音符)' },
            { id: '1/16', name: '1/16 (16分音符)' },
            { id: '1/8', name: '1/8 (8分音符)' },
            { id: '1/4', name: '1/4 (4分音符)' }
        ];
        steps.forEach(s => {
            const opt = document.createElement("option");
            opt.value = s.id;
            opt.textContent = s.name;
            if (s.id === this.state.stepDuration) opt.selected = true;
            stepSelect.appendChild(opt);
        });
        stepSelect.onchange = () => {
            this.state.stepDuration = stepSelect.value;
            this.callbacks.onStateChange();
            if (this.state.autoGenerate) this.callbacks.onGenerate();
        };
        stepLabel.appendChild(stepSelect);
        subRow.appendChild(stepLabel);

        parent.appendChild(subRow);
    }

    private buildToolControls(parent: HTMLElement): void {
        const row1 = document.createElement("div");
        row1.className = "astar-row";
        row1.innerHTML = `<span class="astar-label">描画ツール:</span>`;

        const tools: { id: ToolType; name: string; class: string }[] = [
            { id: 'wall', name: '壁（障害物）', class: 'tool-btn-wall' },
            { id: 'forest', name: '森（コスト3）', class: 'tool-btn-forest' },
            { id: 'bridge', name: 'ブースト（コスト0.5）', class: 'tool-btn-bridge' },
            { id: 'plain', name: '消しゴム（コスト1）', class: 'tool-btn-plain' },
            { id: 'start', name: 'スタート (S)', class: 'tool-btn-start' },
            { id: 'goal', name: 'ゴール (G)', class: 'tool-btn-goal' }
        ];

        const toolButtons: HTMLElement[] = [];
        tools.forEach(t => {
            const btn = document.createElement("button");
            btn.className = `astar-btn ${t.class} ${this.state.tool === t.id ? 'active' : ''}`;
            btn.textContent = t.name;
            btn.onclick = () => {
                this.state.tool = t.id;
                toolButtons.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.callbacks.onStateChange();
            };
            toolButtons.push(btn);
            row1.appendChild(btn);
        });
        parent.appendChild(row1);

        const row2 = document.createElement("div");
        row2.className = "astar-row";
        row2.style.marginTop = "4px";
        row2.innerHTML = `<span class="astar-label">プリセット:</span>`;

        const presets = [
            { id: 'river_bridge', name: '川と橋 (迂回ルート)' },
            { id: 'obstacle_course', name: '障害物コース (上下移動メロディ)' },
            { id: 'random', name: 'ランダム地形' },
            { id: 'empty', name: 'クリア (全平原)' }
        ];

        presets.forEach(p => {
            const btn = document.createElement("button");
            btn.className = "astar-btn astar-btn-preset";
            btn.textContent = p.name;
            btn.onclick = () => {
                this.solver.loadPreset(p.id as any);
                this.updateVisualization();
                this.callbacks.onStateChange();
                if (this.state.autoGenerate) this.callbacks.onGenerate();
            };
            row2.appendChild(btn);
        });
        parent.appendChild(row2);

        // Grid Size Controls (Width & Height)
        const row3 = document.createElement("div");
        row3.className = "astar-row";
        row3.style.marginTop = "6px";
        row3.style.display = "flex";
        row3.style.alignItems = "center";
        row3.style.gap = "16px";
        row3.style.flexWrap = "wrap";
        row3.innerHTML = `<span class="astar-label" style="color: #61dafb;">グリッドサイズ設定:</span>`;

        // 横幅（ステップ数）
        const colContainer = document.createElement("div");
        colContainer.style.display = "flex";
        colContainer.style.alignItems = "center";
        colContainer.style.gap = "6px";

        const colLabel = document.createElement("span");
        colLabel.style.fontSize = "0.85rem";
        colLabel.style.color = "#cbd5e0";
        colLabel.textContent = "横幅 (ステップ数):";
        colContainer.appendChild(colLabel);

        const colMinusBtn = document.createElement("button");
        colMinusBtn.className = "astar-btn";
        colMinusBtn.style.padding = "4px 8px";
        colMinusBtn.style.fontWeight = "bold";
        colMinusBtn.textContent = "-";

        const colInput = document.createElement("input");
        colInput.type = "number";
        colInput.min = "4";
        colInput.max = "64";
        colInput.value = String(this.solver.getCols());
        colInput.style.cssText = "width: 52px; background: #151c25; color: #fff; border: 1px solid #4a5568; padding: 4px 6px; border-radius: 4px; text-align: center; font-weight: bold;";

        const colPlusBtn = document.createElement("button");
        colPlusBtn.className = "astar-btn";
        colPlusBtn.style.padding = "4px 8px";
        colPlusBtn.style.fontWeight = "bold";
        colPlusBtn.textContent = "+";

        const updateCols = (val: number) => {
            const clamped = Math.max(4, Math.min(64, val || 16));
            colInput.value = String(clamped);
            if (clamped !== this.solver.getCols()) {
                this.resizeGrid(clamped, this.solver.getRows());
            }
        };

        colMinusBtn.onclick = () => updateCols(parseInt(colInput.value || "16") - 4);
        colPlusBtn.onclick = () => updateCols(parseInt(colInput.value || "16") + 4);
        colInput.onchange = () => updateCols(parseInt(colInput.value || "16"));

        colContainer.appendChild(colMinusBtn);
        colContainer.appendChild(colInput);
        colContainer.appendChild(colPlusBtn);
        row3.appendChild(colContainer);

        // 縦幅（音域/行数）
        const rowContainer = document.createElement("div");
        rowContainer.style.display = "flex";
        rowContainer.style.alignItems = "center";
        rowContainer.style.gap = "6px";

        const rowLabel = document.createElement("span");
        rowLabel.style.fontSize = "0.85rem";
        rowLabel.style.color = "#cbd5e0";
        rowLabel.textContent = "縦幅 (音域/行数):";
        rowContainer.appendChild(rowLabel);

        const rowMinusBtn = document.createElement("button");
        rowMinusBtn.className = "astar-btn";
        rowMinusBtn.style.padding = "4px 8px";
        rowMinusBtn.style.fontWeight = "bold";
        rowMinusBtn.textContent = "-";

        const rowInput = document.createElement("input");
        rowInput.type = "number";
        rowInput.min = "3";
        rowInput.max = "24";
        rowInput.value = String(this.solver.getRows());
        rowInput.style.cssText = "width: 52px; background: #151c25; color: #fff; border: 1px solid #4a5568; padding: 4px 6px; border-radius: 4px; text-align: center; font-weight: bold;";

        const rowPlusBtn = document.createElement("button");
        rowPlusBtn.className = "astar-btn";
        rowPlusBtn.style.padding = "4px 8px";
        rowPlusBtn.style.fontWeight = "bold";
        rowPlusBtn.textContent = "+";

        const updateRows = (val: number) => {
            const clamped = Math.max(3, Math.min(24, val || 8));
            rowInput.value = String(clamped);
            if (clamped !== this.solver.getRows()) {
                this.resizeGrid(this.solver.getCols(), clamped);
            }
        };

        rowMinusBtn.onclick = () => updateRows(parseInt(rowInput.value || "8") - 1);
        rowPlusBtn.onclick = () => updateRows(parseInt(rowInput.value || "8") + 1);
        rowInput.onchange = () => updateRows(parseInt(rowInput.value || "8"));

        rowContainer.appendChild(rowMinusBtn);
        rowContainer.appendChild(rowInput);
        rowContainer.appendChild(rowPlusBtn);
        row3.appendChild(rowContainer);

        parent.appendChild(row3);
    }

    private resizeGrid(cols: number, rows: number): void {
        this.solver.resize(cols, rows);
        if (this.gridContainerEl) {
            this.gridContainerEl.innerHTML = '';
            this.buildGrid(this.gridContainerEl);
        }
        this.updateVisualization();
        this.callbacks.onStateChange();
        if (this.state.autoGenerate) {
            this.callbacks.onGenerate();
        }
    }

    private yLabelsContainer: HTMLElement | null = null;

    private buildGrid(parent: HTMLElement): void {
        this.yLabelsContainer = document.createElement("div");
        this.yLabelsContainer.className = "astar-y-labels";
        parent.appendChild(this.yLabelsContainer);
        this.rebuildYLabels();

        const gridEl = document.createElement("div");
        gridEl.className = "astar-grid";
        const cols = this.solver.getCols();
        const rows = this.solver.getRows();
        gridEl.style.gridTemplateColumns = `repeat(${cols}, 34px)`;
        gridEl.style.gridTemplateRows = `repeat(${rows}, 34px)`;

        this.gridElements = [];
        for (let x = 0; x < cols; x++) {
            this.gridElements[x] = [];
        }

        // We render Y from 0 to rows-1
        for (let y = 0; y < rows; y++) {
            for (let x = 0; x < cols; x++) {
                const cell = document.createElement("div");
                cell.className = "astar-cell terrain-plain";

                // Mouse event handlers for interactive drawing
                cell.addEventListener('mousedown', (e) => {
                    e.preventDefault();
                    this.isMouseDown = true;
                    this.applyTool(x, y);
                });
                cell.addEventListener('mouseenter', () => {
                    if (this.isMouseDown) {
                        this.applyTool(x, y);
                    }
                });

                gridEl.appendChild(cell);
                this.gridElements[x][y] = cell;
            }
        }

        parent.appendChild(gridEl);
    }

    private rebuildYLabels(): void {
        if (!this.yLabelsContainer) return;
        this.yLabelsContainer.innerHTML = '';
        const rows = this.solver.getRows();
        for (let y = 0; y < rows; y++) {
            const lbl = document.createElement("div");
            lbl.style.height = "34px";
            lbl.style.display = "flex";
            lbl.style.alignItems = "center";
            lbl.style.justifyContent = "flex-end";
            lbl.textContent = this.getRowLabel(y);
            this.yLabelsContainer.appendChild(lbl);
        }
    }

    private applyTool(x: number, y: number): void {
        if (this.state.tool === 'start') {
            this.solver.setStart({ x, y });
        } else if (this.state.tool === 'goal') {
            this.solver.setGoal({ x, y });
        } else {
            this.solver.setTerrain(x, y, this.state.tool as TerrainType);
        }
        this.updateVisualization();
        this.callbacks.onStateChange();
        if (this.state.autoGenerate) {
            this.callbacks.onGenerate();
        }
    }

    private buildStatsPanel(parent: HTMLElement): void {
        parent.innerHTML = `
            <div class="astar-stats-title">探索統計・解析 (Algorithm Analysis)</div>
            <div class="astar-stats-grid">
                <div class="astar-stat-box">
                    <div class="astar-stat-label">探索ステップ数 (Visited)</div>
                    <div class="astar-stat-val" id="astar-val-explored">0</div>
                </div>
                <div class="astar-stat-box">
                    <div class="astar-stat-label">最短経路ステップ数 (Path)</div>
                    <div class="astar-stat-val" id="astar-val-path">0</div>
                </div>
                <div class="astar-stat-box">
                    <div class="astar-stat-label">経路合計コスト (Cost)</div>
                    <div class="astar-stat-val" id="astar-val-cost">0</div>
                </div>
                <div class="astar-stat-box">
                    <div class="astar-stat-label">探索ステータス (Status)</div>
                    <div class="astar-stat-val" id="astar-val-status">SUCCESS</div>
                </div>
            </div>
            <div class="astar-memo" id="astar-memo-text">
                解析中...
            </div>
        `;
        this.statsEl = parent;
        this.academicMemoEl = parent.querySelector("#astar-memo-text") as HTMLElement | null;
    }

    private updateStatsText(exploredCount: number, pathLength: number, totalCost: number, success: boolean): void {
        if (!this.statsEl) return;
        const exploredEl = this.statsEl.querySelector("#astar-val-explored") as HTMLElement | null;
        const pathEl = this.statsEl.querySelector("#astar-val-path") as HTMLElement | null;
        const costEl = this.statsEl.querySelector("#astar-val-cost") as HTMLElement | null;
        const statusEl = this.statsEl.querySelector("#astar-val-status") as HTMLElement | null;

        if (exploredEl) exploredEl.textContent = `${exploredCount} マス`;
        if (pathEl) pathEl.textContent = success ? `${pathLength} ステップ` : `-`;
        if (costEl) costEl.textContent = success ? `${totalCost}` : `-`;
        if (statusEl) {
            statusEl.textContent = success ? "到達成功 (Solved)" : "到達不可 (No Path)";
            statusEl.style.color = success ? "#48bb78" : "#f56565";
        }

        if (this.academicMemoEl) {
            const totalCells = this.solver.getCols() * this.solver.getRows();
            const exploredPct = Math.round((exploredCount / totalCells) * 100);

            if (!success) {
                this.academicMemoEl.innerHTML = `<strong>経路探索失敗:</strong> スタートからゴールまでの経路が壁や障害物に完全に遮られています。障害物を削るか、橋をかけて経路を開放してください。`;
            } else if (this.state.algo === 'dijkstra') {
                this.academicMemoEl.innerHTML = `<strong>ダイクストラ法 (Dijkstra):</strong><br>ゴール位置のヒューリスティクス（推定距離）を持たないため、<strong>全方向に均等にコストの低い順から探索</strong>を行います。この配置では全グリッドの約 <strong>${exploredPct}% (${exploredCount}マス)</strong> を探索して最短経路を見つけました。確実な最短経路を導き出します。`;
            } else if (this.state.algo === 'astar_manhattan') {
                this.academicMemoEl.innerHTML = `<strong>A* (マンハッタン距離):</strong><br>マンハッタン距離ヒューリスティクスにより「できるだけゴール側へ進む」ノードを優先して探索します。この配置では全グリッドの約 <strong>${exploredPct}% (${exploredCount}マス)</strong> の探索で効率的に最短経路へ到達しました。障害物を迂回する起伏がメロディやフレーズのパターンを生み出します。`;
            } else if (this.state.algo === 'astar_euclidean') {
                this.academicMemoEl.innerHTML = `<strong>A* (ユークリッド距離):</strong><br>ユークリッド距離（直線距離）をヒューリスティクスに用いて探索します。4方向移動グリッドにおいてマンハッタン距離よりも推定値がやや小さくなるため、探索範囲は全グリッドの約 <strong>${exploredPct}% (${exploredCount}マス)</strong> となっています。`;
            }
        }
    }

    private buildActionBar(parent: HTMLElement): void {
        const leftBox = document.createElement("div");
        leftBox.style.display = "flex";
        leftBox.style.alignItems = "center";
        leftBox.style.gap = "14px";

        // Auto generate toggle
        const autoLabel = document.createElement("label");
        autoLabel.className = "astar-toggle-label";
        const autoCheckbox = document.createElement("input");
        autoCheckbox.type = "checkbox";
        autoCheckbox.checked = this.state.autoGenerate;
        autoCheckbox.onchange = () => {
            this.state.autoGenerate = autoCheckbox.checked;
            this.callbacks.onStateChange();
            if (this.state.autoGenerate) {
                this.callbacks.onGenerate();
            }
        };
        autoLabel.appendChild(autoCheckbox);
        autoLabel.append(" 迷路変更時にリアルタイム自動MIDI生成");
        leftBox.appendChild(autoLabel);

        parent.appendChild(leftBox);

        // Generate Button
        const genBtn = document.createElement("button");
        genBtn.className = "astar-gen-btn";
        genBtn.innerHTML = `選択トラックにMIDIを生成`;
        genBtn.onclick = () => this.callbacks.onGenerate();
        parent.appendChild(genBtn);
    }
}
