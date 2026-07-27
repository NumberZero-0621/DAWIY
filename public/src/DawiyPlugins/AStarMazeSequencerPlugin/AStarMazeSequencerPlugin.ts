import App from "../../App";
import { RATIO_MILLS_BY_PX, TEMPO } from "../../Env";
import MIDIRegion from "../../Models/Region/MIDIRegion";
import { MIDINote, MIDI } from "../../Audio/MIDI/MIDI";
import { DAWIYPlugin } from "../IDawiyPlugin";
import DawiyPluginBase from "../DawiyPluginBase";
import { MazeSolver } from "./MazeSolver";
import { MazeUI, UIState } from "./MazeUI";

@DAWIYPlugin
export default class AStarMazeSequencerPlugin extends DawiyPluginBase {
    id = "astar-maze-sequencer";
    name = "A* Maze Sequencer";
    description = "探索アルゴリズム（A*／ダイクストラ法）で迷路を解き、その経路をメロディやドラムパターンとして自動生成するシーケンサー。";
    group = "Generator";

    private solver: MazeSolver;
    private ui: MazeUI | null = null;

    private state: UIState = {
        algo: 'astar_manhattan',
        mode: 'melody',
        tool: 'wall',
        allowDiagonals: false,
        autoGenerate: false,
        stepDuration: '1/16',
        scale: 'Major',
        basePitch: 60 // C4
    };

    constructor(app: App) {
        super(app);
        this.solver = new MazeSolver(16, 8);
        // Load default River & Bridge preset for immediate educational & musical appeal
        this.solver.loadPreset('river_bridge');
    }

    public override render(container: HTMLElement) {
        this.ui = new MazeUI(container, this.solver, this.state, {
            onGenerate: () => this.generateMIDI(),
            onStateChange: () => {
                if (this.ui) {
                    this.state = this.ui.getState();
                }
            }
        });
        this.ui.render();
    }

    public override getUserData(): any {
        return {
            state: this.state
        };
    }

    public override setUserData(data: any): void {
        if (data && data.state) {
            this.state = { ...this.state, ...data.state };
        }
    }

    public override getProjectData(): any {
        return {
            state: this.state,
            maze: this.solver.exportState()
        };
    }

    public override setProjectData(data: any): void {
        if (data) {
            if (data.state) {
                this.state = { ...this.state, ...data.state };
            }
            if (data.maze) {
                this.solver.importState(data.maze);
            }
            if (this.ui) {
                this.ui.render();
            }
        }
    }

    private generateMIDI(): void {
        const track = this.app.tracksController.selectedTrack;
        if (!track) {
            this.app.hostAPI.ui.showToast("ターゲットとなるトラックが選択されていません。トラックを選択してください。", true);
            return;
        }

        const result = this.solver.solve(this.state.algo, this.state.allowDiagonals);
        if (!result.success || result.path.length === 0) {
            this.app.hostAPI.ui.showToast("ゴールへの到達経路が見つかりません。壁や川を削ってルートを開放してください。", true);
            return;
        }

        // Determine start time from current playhead position
        const startMs = this.app.host.playhead || 0;

        // Calculate step duration in ms
        const beatMs = (60 / TEMPO) * 1000;
        let stepMs = beatMs / 4; // default 1/16
        if (this.state.stepDuration === '1/4') stepMs = beatMs;
        else if (this.state.stepDuration === '1/8') stepMs = beatMs / 2;
        else if (this.state.stepDuration === '1/32') stepMs = beatMs / 8;

        const totalDurationMs = stepMs * result.path.length;
        const midi = new MIDI(500, totalDurationMs);

        result.path.forEach((p, idx) => {
            const noteStartMs = idx * stepMs;
            const noteDurationMs = stepMs * 0.85; // Slightly articulated

            let pitch = 60;
            if (this.ui) {
                pitch = this.ui.getPitchForRow(p.y);
            }

            // Determine velocity based on terrain cost and rhythmic accent
            const terrain = this.solver.getTerrain(p.x, p.y);
            let vel = 100;
            if (terrain === 'forest') vel = 45;        // Quiet / ghost note for forest/swamp
            else if (terrain === 'bridge') vel = 127;  // Maximum accent / boost for bridge
            else if ((p.x === this.solver.getStart().x && p.y === this.solver.getStart().y) ||
                     (p.x === this.solver.getGoal().x && p.y === this.solver.getGoal().y)) {
                vel = 115;
            } else if (idx % 4 === 0) {
                vel = 110;                             // Downbeat rhythmic accent
            } else if (idx % 2 === 0) {
                vel = 95;
            }

            // Put note into MIDI (pass raw velocity integer 0-127 as used across DAWIY plugins)
            midi.putNote(new MIDINote(pitch, vel, 0, noteDurationMs), noteStartMs);
        });

        const newRegion = new MIDIRegion(midi, startMs);

        this.app.doIt(true,
            () => {
                this.app.regionsController.addRegion(track, newRegion);
                if (this.app.pianoRollController.isVisible) this.app.pianoRollController.redraw();
                this.app.hostAPI.ui.showToast(`トラック「${track.element.name}」に ${result.path.length} ステップのフレーズを生成しました。`);
            },
            () => {
                this.app.regionsController.removeRegion(newRegion);
                if (this.app.pianoRollController.isVisible) this.app.pianoRollController.redraw();
                this.app.hostAPI.ui.showToast("MIDI生成を元に戻しました。");
            }
        );
    }
}
