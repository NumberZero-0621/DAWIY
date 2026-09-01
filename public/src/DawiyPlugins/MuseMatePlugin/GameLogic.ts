export interface DailyStats {
    date: string;
    midiNotes: number;
    audioRegions: number;
    parametersChanged: number;
    chats: number;
    sessionTimeSeconds: number;
}

export interface AffectionHistoryEntry {
    timestamp: number;
    score: number;
}

export class GameLogic {
    private affectionScore: number = 0;
    private timerInterval: any = null;
    private pomodoroTimeRemaining: number = 25 * 60;
    private isPomodoroRunning: boolean = false;
    private uiCallback: () => void;
    
    // Stats for gamification
    private sessionStartTime: number = Date.now();
    public totalOperations: number = 0;
    public totalRegions: number = 0;
    
    // Daily Stats & Graph Data
    public dailyStats: Record<string, DailyStats> = {};
    public affectionHistory: AffectionHistoryEntry[] = [];
    private sessionTimerInterval: any = null;

    constructor(uiCallback: () => void) {
        this.uiCallback = uiCallback;
        
        // Reward passive time spent
        setInterval(() => {
            this.addAffection(1, "time spent");
        }, 1000 * 60 * 5); // 1 affection point every 5 minutes

        // Track session time (add 1 second every second to today's stats)
        this.sessionTimerInterval = setInterval(() => {
            const today = this.getTodayString();
            this.ensureDailyStats(today);
            this.dailyStats[today].sessionTimeSeconds++;
            
            // Periodically refresh the dashboard UI if open? 
            // We can call uiCallback, but that might be heavy if done every second.
            // Let's call it every 5 seconds for dashboard updates.
            if (this.dailyStats[today].sessionTimeSeconds % 5 === 0) {
                this.uiCallback();
            }
        }, 1000);
    }

    private getTodayString(): string {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }

    private ensureDailyStats(dateStr: string) {
        if (!this.dailyStats[dateStr]) {
            this.dailyStats[dateStr] = {
                date: dateStr,
                midiNotes: 0,
                audioRegions: 0,
                parametersChanged: 0,
                chats: 0,
                sessionTimeSeconds: 0
            };
        }
    }

    public getTodayStats(): DailyStats {
        const today = this.getTodayString();
        this.ensureDailyStats(today);
        return this.dailyStats[today];
    }

    // --- Metric tracking ---
    public recordMidiCount(count: number) {
        const today = this.getTodayString();
        this.ensureDailyStats(today);
        this.dailyStats[today].midiNotes = count; // Override with current total
    }

    public recordAudioRegionCount(count: number) {
        const today = this.getTodayString();
        this.ensureDailyStats(today);
        this.dailyStats[today].audioRegions = count; // Override with current total
    }

    public recordParameterChange() {
        const today = this.getTodayString();
        this.ensureDailyStats(today);
        this.dailyStats[today].parametersChanged++;
        
        this.totalOperations++;
        if (this.totalOperations % 10 === 0) {
            this.addAffection(2, "operation milestone");
        }
        
        this.uiCallback();
    }

    public recordChat() {
        const today = this.getTodayString();
        this.ensureDailyStats(today);
        this.dailyStats[today].chats++;
        this.addAffection(2, "chat sent");
    }

    public recordRegionAdded() {
        this.totalRegions++;
        this.addAffection(5, "region added");
    }

    public getAffectionScore() {
        return this.affectionScore;
    }

    public setAffectionScore(score: number) {
        this.affectionScore = score;
        this.recordAffectionHistory();
        this.uiCallback();
    }

    public addAffection(points: number, reason: string) {
        this.affectionScore += points;
        console.log(`[Muse Mate] +${points} Affection (${reason}). Total: ${this.affectionScore}`);
        this.recordAffectionHistory();
        this.uiCallback();
    }

    private recordAffectionHistory() {
        this.affectionHistory.push({
            timestamp: Date.now(),
            score: this.affectionScore
        });
        
        // Keep last 100 points to prevent memory leak
        if (this.affectionHistory.length > 100) {
            this.affectionHistory.shift();
        }
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
            totalOperations: this.totalOperations,
            totalRegions: this.totalRegions,
            lastLogin: Date.now(),
            dailyStats: this.dailyStats,
            affectionHistory: this.affectionHistory
        };
    }

    public loadSaveData(data: any) {
        if (!data) return;
        if (typeof data.affectionScore === 'number') this.affectionScore = data.affectionScore;
        if (typeof data.totalOperations === 'number') this.totalOperations = data.totalOperations;
        if (typeof data.totalRegions === 'number') this.totalRegions = data.totalRegions;
        if (data.dailyStats) this.dailyStats = data.dailyStats;
        if (data.affectionHistory) this.affectionHistory = data.affectionHistory;
        
        // Daily login bonus
        if (data.lastLogin) {
            const lastDate = new Date(data.lastLogin).toDateString();
            const todayDate = new Date().toDateString();
            if (lastDate !== todayDate) {
                this.addAffection(10, "daily login");
            }
        }
        
        // Ensure at least one initial affection history point
        if (this.affectionHistory.length === 0) {
            this.recordAffectionHistory();
        }
        
        this.uiCallback();
    }
}
