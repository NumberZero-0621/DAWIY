
import { MIDI, MIDINote } from "./MIDI";

describe("MIDI Class Static Methods", () => {
    describe("getPitchLabel", () => {
        test("should return correct pitch label", () => {
            expect(MIDI.getPitchLabel(60)).toBe("C4");
            expect(MIDI.getPitchLabel(61)).toBe("C#4");
            expect(MIDI.getPitchLabel(72)).toBe("C5");
            expect(MIDI.getPitchLabel(0)).toBe("C-1");
        });
    });

    describe("getScaleNotes", () => {
        test("should return correct notes for C major scale", () => {
            // C4 to C5
            const notes = MIDI.getScaleNotes(60, 72, 60, "major");
            expect(notes).toEqual([60, 62, 64, 65, 67, 69, 71, 72]);
        });

        test("should return correct notes for A minor scale", () => {
            // A4 to A5 (minor)
            // A4=69. A minor: A B C D E F G A
            // 69, 71, 72, 74, 76, 77, 79, 81
            const notes = MIDI.getScaleNotes(69, 81, 69, "minor");
            expect(notes).toEqual([69, 71, 72, 74, 76, 77, 79, 81]);
        });
    });
});

describe("MIDI Glitch Effect", () => {
    test("should chop notes based on step", () => {
        // Create 1 second MIDI with one long note
        const midi = new MIDI(500, 1000);
        midi.putNote(new MIDINote(60, 100, 0, 1000), 0);

        // Chop into 250ms steps
        // This should result in 4 notes of 250ms each (if glitch parameters are 0)
        const glitched = midi.glitch(250, 0, 0);

        // Check number of notes
        // Note: glitch logic reconstructs notes.
        // It should have 4 notes.
        let count = 0;
        glitched.forEachNote(() => count++);
        expect(count).toBeGreaterThanOrEqual(4);
    });
});
