export type TerrainType = 'plain' | 'forest' | 'bridge' | 'wall';
export type AlgorithmType = 'dijkstra' | 'astar_manhattan' | 'astar_euclidean';

export interface Point {
    x: number;
    y: number;
}

export interface SolveResult {
    path: Point[];
    explored: Point[];
    totalCost: number;
    exploredCount: number;
    pathLength: number;
    success: boolean;
}

export const TERRAIN_COSTS: Record<TerrainType, number> = {
    plain: 1.0,
    forest: 3.0,
    bridge: 0.5,
    wall: Infinity
};

export const TERRAIN_NAMES: Record<TerrainType, string> = {
    plain: '平原 (Plains / Cost: 1.0)',
    forest: '森/沼地 (Forest / Cost: 3.0)',
    bridge: '橋/ブースト (Bridge / Cost: 0.5)',
    wall: '壁/川 (Wall / Impassable)'
};

export class MazeSolver {
    private cols: number;
    private rows: number;
    private grid: TerrainType[][];
    private start: Point;
    private goal: Point;

    constructor(cols = 16, rows = 8) {
        this.cols = cols;
        this.rows = rows;
        this.grid = this.createEmptyGrid(cols, rows);
        this.start = { x: 0, y: Math.floor(rows / 2) };
        this.goal = { x: cols - 1, y: Math.floor(rows / 2) };
    }

    public getCols(): number { return this.cols; }
    public getRows(): number { return this.rows; }
    public getStart(): Point { return { ...this.start }; }
    public getGoal(): Point { return { ...this.goal }; }
    public getTerrain(x: number, y: number): TerrainType {
        if (!this.isValid(x, y)) return 'wall';
        return this.grid[x][y];
    }

    public setStart(p: Point): void {
        if (this.isValid(p.x, p.y) && (p.x !== this.goal.x || p.y !== this.goal.y)) {
            this.start = { ...p };
            if (this.grid[p.x][p.y] === 'wall') {
                this.grid[p.x][p.y] = 'plain';
            }
        }
    }

    public setGoal(p: Point): void {
        if (this.isValid(p.x, p.y) && (p.x !== this.start.x || p.y !== this.start.y)) {
            this.goal = { ...p };
            if (this.grid[p.x][p.y] === 'wall') {
                this.grid[p.x][p.y] = 'plain';
            }
        }
    }

    public setTerrain(x: number, y: number, terrain: TerrainType): void {
        if (!this.isValid(x, y)) return;
        // Don't place walls on start or goal
        if (terrain === 'wall' && ((x === this.start.x && y === this.start.y) || (x === this.goal.x && y === this.goal.y))) {
            return;
        }
        this.grid[x][y] = terrain;
    }

    public resize(cols: number, rows: number): void {
        const newGrid = this.createEmptyGrid(cols, rows);
        for (let x = 0; x < Math.min(this.cols, cols); x++) {
            for (let y = 0; y < Math.min(this.rows, rows); y++) {
                newGrid[x][y] = this.grid[x][y];
            }
        }
        this.cols = cols;
        this.rows = rows;
        this.grid = newGrid;

        if (!this.isValid(this.start.x, this.start.y)) {
            this.start = { x: 0, y: Math.floor(rows / 2) };
        }
        if (!this.isValid(this.goal.x, this.goal.y)) {
            this.goal = { x: cols - 1, y: Math.floor(rows / 2) };
        }
    }

    public clear(defaultTerrain: TerrainType = 'plain'): void {
        for (let x = 0; x < this.cols; x++) {
            for (let y = 0; y < this.rows; y++) {
                this.grid[x][y] = defaultTerrain;
            }
        }
    }

    public loadPreset(preset: 'empty' | 'obstacle_course' | 'river_bridge' | 'random'): void {
        this.clear('plain');
        const midY = Math.floor(this.rows / 2);
        this.start = { x: 0, y: midY };
        this.goal = { x: this.cols - 1, y: midY };

        if (preset === 'obstacle_course') {
            // Place vertical walls forcing vertical navigation
            const col1 = Math.floor(this.cols * 0.25);
            const col2 = Math.floor(this.cols * 0.5);
            const col3 = Math.floor(this.cols * 0.75);

            for (let y = 0; y < this.rows - 2; y++) {
                this.setTerrain(col1, y, 'wall');
            }
            for (let y = 2; y < this.rows; y++) {
                this.setTerrain(col2, y, 'wall');
            }
            for (let y = 0; y < this.rows - 2; y++) {
                this.setTerrain(col3, y, 'wall');
            }
            // Add some forests and bridges
            this.setTerrain(col1 - 1, 0, 'forest');
            this.setTerrain(col1 - 1, 1, 'forest');
            this.setTerrain(col2 - 1, this.rows - 1, 'bridge');
            this.setTerrain(col2 - 1, this.rows - 2, 'bridge');

        } else if (preset === 'river_bridge') {
            // A vertical river (wall) across the middle with two bridges
            const riverCol = Math.floor(this.cols / 2);
            for (let y = 0; y < this.rows; y++) {
                this.setTerrain(riverCol, y, 'wall');
            }
            // Two bridge crossings
            const bridgeY1 = Math.max(0, midY - 2);
            const bridgeY2 = Math.min(this.rows - 1, midY + 2);
            this.setTerrain(riverCol, bridgeY1, 'bridge');
            this.setTerrain(riverCol, bridgeY2, 'bridge');
            this.setTerrain(riverCol - 1, bridgeY1, 'bridge');
            this.setTerrain(riverCol + 1, bridgeY1, 'bridge');

        } else if (preset === 'random') {
            for (let x = 0; x < this.cols; x++) {
                for (let y = 0; y < this.rows; y++) {
                    if ((x === this.start.x && y === this.start.y) || (x === this.goal.x && y === this.goal.y)) {
                        continue;
                    }
                    const r = Math.random();
                    if (r < 0.2) this.setTerrain(x, y, 'wall');
                    else if (r < 0.35) this.setTerrain(x, y, 'forest');
                    else if (r < 0.45) this.setTerrain(x, y, 'bridge');
                }
            }
        }
    }

    public solve(algo: AlgorithmType, allowDiagonals = false): SolveResult {
        const startKey = this.key(this.start.x, this.start.y);
        const goalKey = this.key(this.goal.x, this.goal.y);

        const openSet: Point[] = [ { ...this.start } ];
        const openSetKeys = new Set<string>([ startKey ]);
        const closedSetKeys = new Set<string>();
        const explored: Point[] = [];

        const gScore = new Map<string, number>();
        const fScore = new Map<string, number>();
        const cameFrom = new Map<string, Point>();

        // Initialize scores
        gScore.set(startKey, 0);
        fScore.set(startKey, this.heuristic(this.start, this.goal, algo));

        while (openSet.length > 0) {
            // Find node with lowest fScore in openSet
            let lowestIdx = 0;
            let lowestF = fScore.get(this.key(openSet[0].x, openSet[0].y)) ?? Infinity;

            for (let i = 1; i < openSet.length; i++) {
                const k = this.key(openSet[i].x, openSet[i].y);
                const f = fScore.get(k) ?? Infinity;
                if (f < lowestF) {
                    lowestF = f;
                    lowestIdx = i;
                }
            }

            const current = openSet[lowestIdx];
            const currentKey = this.key(current.x, current.y);

            // Remove current from openSet
            openSet.splice(lowestIdx, 1);
            openSetKeys.delete(currentKey);
            closedSetKeys.add(currentKey);

            // Add to explored list (if not start)
            if (currentKey !== startKey && currentKey !== goalKey) {
                explored.push({ ...current });
            }

            // Check if goal reached
            if (current.x === this.goal.x && current.y === this.goal.y) {
                const path = this.reconstructPath(cameFrom, current);
                const totalCost = gScore.get(goalKey) ?? 0;
                return {
                    path,
                    explored,
                    totalCost: Math.round(totalCost * 100) / 100,
                    exploredCount: explored.length + 2, // Include start and goal
                    pathLength: path.length,
                    success: true
                };
            }

            // Get neighbors
            const neighbors = this.getNeighbors(current, allowDiagonals);
            for (const nbr of neighbors) {
                const nbrKey = this.key(nbr.x, nbr.y);
                if (closedSetKeys.has(nbrKey)) continue;

                const terrain = this.getTerrain(nbr.x, nbr.y);
                if (terrain === 'wall') continue;

                const stepCost = TERRAIN_COSTS[terrain] * (this.isDiagonal(current, nbr) ? Math.SQRT2 : 1.0);
                const tentativeG = (gScore.get(currentKey) ?? Infinity) + stepCost;

                if (tentativeG < (gScore.get(nbrKey) ?? Infinity)) {
                    cameFrom.set(nbrKey, { ...current });
                    gScore.set(nbrKey, tentativeG);
                    const h = this.heuristic(nbr, this.goal, algo);
                    fScore.set(nbrKey, tentativeG + h);

                    if (!openSetKeys.has(nbrKey)) {
                        openSet.push({ ...nbr });
                        openSetKeys.add(nbrKey);
                    }
                }
            }
        }

        // No path found
        return {
            path: [],
            explored,
            totalCost: 0,
            exploredCount: explored.length + 1,
            pathLength: 0,
            success: false
        };
    }

    public exportState(): any {
        return {
            cols: this.cols,
            rows: this.rows,
            grid: this.grid,
            start: this.start,
            goal: this.goal
        };
    }

    public importState(data: any): void {
        if (!data || !data.grid) return;
        this.cols = data.cols || 16;
        this.rows = data.rows || 8;
        this.grid = data.grid;
        if (data.start) this.start = data.start;
        if (data.goal) this.goal = data.goal;
    }

    private createEmptyGrid(cols: number, rows: number): TerrainType[][] {
        const grid: TerrainType[][] = [];
        for (let x = 0; x < cols; x++) {
            grid[x] = [];
            for (let y = 0; y < rows; y++) {
                grid[x][y] = 'plain';
            }
        }
        return grid;
    }

    private isValid(x: number, y: number): boolean {
        return x >= 0 && x < this.cols && y >= 0 && y < this.rows;
    }

    private key(x: number, y: number): string {
        return `${x},${y}`;
    }

    private isDiagonal(p1: Point, p2: Point): boolean {
        return p1.x !== p2.x && p1.y !== p2.y;
    }

    private getNeighbors(p: Point, allowDiagonals: boolean): Point[] {
        const dirs = [
            { x: 0, y: -1 }, // Up
            { x: 1, y: 0 },  // Right
            { x: 0, y: 1 },  // Down
            { x: -1, y: 0 }  // Left
        ];

        if (allowDiagonals) {
            dirs.push(
                { x: 1, y: -1 }, { x: 1, y: 1 },
                { x: -1, y: 1 }, { x: -1, y: -1 }
            );
        }

        const neighbors: Point[] = [];
        for (const d of dirs) {
            const nx = p.x + d.x;
            const ny = p.y + d.y;
            if (this.isValid(nx, ny)) {
                neighbors.push({ x: nx, y: ny });
            }
        }
        return neighbors;
    }

    private heuristic(p1: Point, p2: Point, algo: AlgorithmType): number {
        if (algo === 'dijkstra') return 0;

        const dx = Math.abs(p1.x - p2.x);
        const dy = Math.abs(p1.y - p2.y);
        const minCost = TERRAIN_COSTS.bridge; // 0.5 (admissible heuristic scaling)

        if (algo === 'astar_manhattan') {
            return (dx + dy) * minCost;
        } else if (algo === 'astar_euclidean') {
            return Math.sqrt(dx * dx + dy * dy) * minCost;
        }
        return 0;
    }

    private reconstructPath(cameFrom: Map<string, Point>, current: Point): Point[] {
        const path: Point[] = [ { ...current } ];
        let currKey = this.key(current.x, current.y);

        while (cameFrom.has(currKey)) {
            const prev = cameFrom.get(currKey)!;
            path.unshift({ ...prev });
            currKey = this.key(prev.x, prev.y);
        }
        return path;
    }
}
