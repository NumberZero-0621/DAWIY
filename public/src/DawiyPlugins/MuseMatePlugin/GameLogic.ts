export class GameLogic {
    private affectionScore: number = 0;
    private timerInterval: any = null;
    private pomodoroTimeRemaining: number = 25 * 60; // 25 minutes default
    private isPomodoroRunning: boolean = false;
    private uiCallback: () => void;
    
    // Stats for gamification
    private sessionStartTime: number = Date.now();
    private operationCount: number = 0;
    private regionAddedCount: number = 0;

    constructor(uiCallback: () => void) {
        this.uiCallback = uiCallback;
        
        // Reward passive time spent
        setInterval(() => {
            this.addAffection(1, "time spent");
        }, 1000 * 60 * 5); // 1 affection point every 5 minutes
    }

    public getAffectionScore() {
        return this.affectionScore;
    }

    public setAffectionScore(score: number) {
        this.affectionScore = score;
        this.uiCallback();
    }

    public addAffection(points: number, reason: string) {
        this.affectionScore += points;
        console.log(`[Muse Mate] +${points} Affection (${reason}). Total: ${this.affectionScore}`);
        this.uiCallback();
    }

    public recordOperation() {
        this.operationCount++;
        if (this.operationCount % 10 === 0) {
            this.addAffection(2, "operation milestone");
        }
    }

    public recordRegionAdded() {
        this.regionAddedCount++;
        this.addAffection(5, "region added");
    }

    // Pomodoro logic
    public startPomodoro(minutes: number = 25) {
        if (this.isPomodoroRunning) return;
        this.pomodoroTimeRemaining = minutes * 60;
        this.isPomodoroRunning = true;
        this.timerInterval = setInterval(() => {
            this.pomodoroTimeRemaining--;
            if (this.pomodoroTimeRemaining <= 0) {
                this.stopPomodoro();
                this.addAffection(20, "pomodoro completed");
                alert("Pomodoro session completed! Great job!"); // Can be replaced with voice later
            }
            this.uiCallback();
        }, 1000);
        this.uiCallback();
    }

    public stopPomodoro() {
        if (this.timerInterval) clearInterval(this.timerInterval);
        this.isPomodoroRunning = false;
        this.uiCallback();
    }

    public getFormattedTimer(): string {
        const m = Math.floor(this.pomodoroTimeRemaining / 60).toString().padStart(2, '0');
        const s = (this.pomodoroTimeRemaining % 60).toString().padStart(2, '0');
        return `${m}:${s}`;
    }

    public get isTimerRunning() {
        return this.isPomodoroRunning;
    }

    public getSaveData(): any {
        return {
            affectionScore: this.affectionScore,
            totalOperations: this.operationCount,
            totalRegions: this.regionAddedCount,
            lastLogin: Date.now()
        };
    }

    public loadSaveData(data: any) {
        if (!data) return;
        if (typeof data.affectionScore === 'number') this.affectionScore = data.affectionScore;
        if (typeof data.totalOperations === 'number') this.operationCount = data.totalOperations;
        if (typeof data.totalRegions === 'number') this.regionAddedCount = data.totalRegions;
        
        // Daily login bonus
        if (data.lastLogin) {
            const lastDate = new Date(data.lastLogin).toDateString();
            const todayDate = new Date().toDateString();
            if (lastDate !== todayDate) {
                this.addAffection(10, "daily login");
            }
        }
        this.uiCallback();
    }
}
