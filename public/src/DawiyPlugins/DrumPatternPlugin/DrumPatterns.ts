export interface DrumNote {
    pitch: number;
    start: number;
    duration: number;
}

export interface PatternParams {
    pattern: string;
    kickNote: number;
    snareNote: number;
    hihatNote: number;
    velocity: number;
}

export const PATTERNS = [
    { id: "basic_rock", name: "Basic Rock (K-S-K-S)" },
    { id: "four_floor", name: "Four on the Floor (Techno)" },
    { id: "hiphop", name: "Simple HipHop" },
];

export function addNotesForStep(pattern: string, step: number, time: number, duration: number, list: DrumNote[], params: PatternParams) {
    const { kickNote, snareNote, hihatNote } = params;

    // Patterns (16 steps, 0-15)
    if (pattern === "basic_rock") {
        // Kick
        if (step === 0 || step === 10) list.push({ pitch: kickNote, start: time, duration });
        // Snare
        if (step === 4 || step === 12) list.push({ pitch: snareNote, start: time, duration });
        // HiHat (8ths)
        if (step % 2 === 0) list.push({ pitch: hihatNote, start: time, duration });
    }
    else if (pattern === "four_floor") {
        // Kick on every beat
        if (step % 4 === 0) list.push({ pitch: kickNote, start: time, duration });
        // Off-beat HiHat
        if (step % 4 === 2) list.push({ pitch: hihatNote, start: time, duration }); // Open HH?
        // Clap/Snare on 2 and 4
        if (step === 4 || step === 12) list.push({ pitch: snareNote, start: time, duration });
    }
    else if (pattern === "hiphop") {
        // Kick: 0, 7, 10
        if (step === 0 || step === 7 || step === 10) list.push({ pitch: kickNote, start: time, duration });
        // Snare: 4, 12
        if (step === 4 || step === 12) list.push({ pitch: snareNote, start: time, duration });
        // HiHat: 16ths
        list.push({ pitch: hihatNote, start: time, duration: duration * 0.8 });
    }
}
