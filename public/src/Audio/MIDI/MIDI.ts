import { parseSFMMidi } from "./MIDILoaders"

/**
 * A note on a MIDI track with a frequency, a velocity, a channel and a duration.
 * Non-mutable so that it can be shared between multiple MIDI tracks instead of cloned, saving memory and CPU time.
 */
export class MIDINote {

    /**
     * Create a new MIDI note.
     * @param note The note as MIDI note, an integer between 0 and 128.
     * @param velocity The note velocity, between 0 and 1.
     * @param channel The MIDI channel, an integer.
     * @param duration The note duration in milliseconds.
     */
    constructor(
        public readonly note: number,
        public readonly velocity: number,
        public readonly channel: number,
        public readonly duration: number,
    ) { }

    /*static load(array: Float32Array): MIDINote{
        return new MIDINote(array[0],array[1],array[2],array[3])
    }

    saveTo(array: Float32Array){
        array[0]=this.note
        array[1]=this.velocity
        array[2]=this.channel
        array[3]=this.duration
    }*/
}


/**
 * A list of notes on a MIDI track played in the same small time interval.
 */
export type MIDIInstant = Array<{ offset: number, note: MIDINote }>


/**
 * A view of a MIDI track, abstracting the way the MIDI track is stored.
 * You can get all instants and the instant duration.
 * The track has a fixed duration, some instant can be out of the track.
 * The duration of the track is at the end of note that ends the latest.
 */
export abstract class MIDIView {

    /** Get the duration of the MIDIView */
    abstract get duration(): number

    /** The duration of a single instant in milliseconds. */
    abstract get instant_duration(): number

    /** The number of instants in the MIDI track. */
    abstract get instant_count(): number

    /**
     * Iterate over all notes in the MIDI track.
     * @param callback The callback to call for each note.
     */
    abstract forEachNote(callback: (note: MIDINote, start: number) => void): void

    /**
     * Get all notes in the MIDI track.
     */
    get notes(): { note: MIDINote, start: number }[] {
        const notes: { note: MIDINote, start: number }[] = []
        this.forEachNote((note, start) => {
            notes.push({ note, start })
        })
        return notes
    }

    /**
     * Chop the MIDI track into small pieces of duration step.
     * @param step The duration of the pieces in milliseconds.
     * @param start The start of the chopping in milliseconds.
     * @param end The end of the chopping in milliseconds.
     */
    chop(step: number, start: number = 0, end: number = this.duration): MIDI {
        const notes = this.notes
        const new_notes: { note: MIDINote, start: number }[] = []

        for (const { note, start: noteStart } of notes) {
            const noteEnd = noteStart + note.duration

            // If completely outside, keep as is
            if (noteEnd <= start || noteStart >= end) {
                new_notes.push({ note, start: noteStart })
                continue
            }

            // Handle overlap
            // 1. Part before start
            if (noteStart < start) {
                new_notes.push({
                    note: new MIDINote(note.note, note.velocity, note.channel, start - noteStart),
                    start: noteStart
                })
            }

            // 2. Part after end
            if (noteEnd > end) {
                new_notes.push({
                    note: new MIDINote(note.note, note.velocity, note.channel, noteEnd - end),
                    start: end
                })
            }

            // 3. Inner part
            const innerStart = Math.max(noteStart, start)
            const innerEnd = Math.min(noteEnd, end)

            if (innerEnd > innerStart) {
                let currentPos = innerStart
                while (currentPos < innerEnd) {
                    const relativeP = currentPos - start
                    const nextGridIndex = Math.floor(relativeP / step) + 1
                    const nextGridPos = start + (nextGridIndex * step)
                    const segEnd = Math.min(innerEnd, nextGridPos)
                    const duration = segEnd - currentPos

                    if (duration > 0.001) {
                        new_notes.push({
                            note: new MIDINote(note.note, note.velocity, note.channel, duration),
                            start: currentPos
                        })
                    }
                    currentPos = segEnd
                }
            }
        }

        return MIDI.fromNotes(new_notes, this.instant_duration)
    }


    /**
     * Add a note to the MIDI track inside the already existing instants.
     * @param note The note to add.
     * @param start The start time of the note in milliseconds.
     */
    abstract putNote(note: MIDINote, start: number): void

    /**
     * Merge another MIDI track into this one.
     * @param instant_index 
     * @param note_index 
     * @param newend 
     */
    mergeFrom(other: MIDIView): void {
        other.forEachNote((note, start) => {
            this.putNote(new MIDINote(note.note, note.velocity, note.channel, note.duration), start)
        })
    }

    /**
     * Clone the MIDI
     */
    clone(): MIDI {
        const cloned = new MIDI(this.instant_duration, this.duration)
        cloned.mergeFrom(this)
        return cloned
    }

    /**
     * Create a new MIDI with the start and end of a note at a note each.
     * The start of a note have a duration of 0.
     * The end of a note have a duration of 1.
     */
    asEvent(): MIDI {
        const midi = new MIDI(this.instant_duration, this.duration)
        this.forEachNote((note, start) => {
            midi.putNote(new MIDINote(note.note, note.velocity, note.channel, 0), start)
            midi.putNote(new MIDINote(note.note, note.velocity, note.channel, 1), start + note.duration - 1)
        })
        return midi
    }

    /**
     * Create a new MIDI with the same notes but with a recalculated and optimized instant duration.
     * @param retry The number of time to retry the optimization, to get a better result.
     * @param variation A value by which the calculated instant_duration is multiplied.
     */
    optimized(retry: number = 0): MIDI {
        let correction = 1
        let from: MIDIView = this
        for (let i = 0; i <= retry; i++) {
            let min_start = Infinity
            let max_start = -Infinity
            let duration = 0
            let note_count = 0
            let previous_start = 0
            from.forEachNote((note, start) => {
                if (start < min_start) min_start = start
                if (start > max_start) max_start = start
                const new_duration = start + note.duration
                if (new_duration > duration) duration = new_duration
                previous_start = start
                note_count++
            })
            let range = max_start - min_start
            if (range == 0) range = duration

            const optimized = new MIDI(range / note_count * correction, duration)
            from.forEachNote((note, start) => optimized.putNote(note, start))

            if (i == retry) return optimized
            else {
                let number_of_empty_cell = 0
                let number_of_full_cell = 0
                for (let ii = 0; ii < optimized.instants.length; ii++) {
                    if (optimized.instants[0].length > 1) number_of_full_cell++
                    else if (optimized.instants[0].length == 0) number_of_empty_cell++
                }
                if (number_of_empty_cell > number_of_full_cell) correction *= 1.1
                else if (number_of_full_cell > number_of_empty_cell) correction *= 0.9
                from = optimized
            }
        }
        return this.clone()
    }

    /**
     * Clone the MIDI with a different instant duration.
     * @param new_instant_duration 
     * @returns 
     */
    withInstantDuration(new_instant_duration: number): MIDI {
        const new_midi = new MIDI(new_instant_duration, this.instant_count * new_instant_duration)
        this.forEachNote((note, start) => {
            new_midi.putNote(note, start)
        })
        new_midi.pack()
        return new_midi
    }

    /** Create a mutable view on a subpart of the MIDI Track */
    view(start: number, duration?: number) {
        return new SubMIDI(this, start, duration)
    }

    /**
     * Mix to midi into a new MIDI that contains both
     * @param other
     * @param start an offset from this MIDI to the other MIDI in milliseconds.
     */
    merge(other: MIDIView, start: number) {
        const max_duration = Math.max(this.duration, start + other.duration)
        const empty = MIDI.empty(this.instant_duration, max_duration)
        empty.mergeFrom(this)
        empty.view(start).mergeFrom(other)
        return empty
    }
}


/**
 * A MIDI track, represented as a sequence of MIDIInstant.
 */
export class MIDI extends MIDIView {


    /* FACTORIES */

    static scaleTypes: { [key: string]: number[] } = {
        "major": [0, 2, 4, 5, 7, 9, 11],
        "minor": [0, 2, 3, 5, 7, 8, 10],
        "harmonic_minor": [0, 2, 3, 5, 7, 8, 11],
        "pentatonic_major": [0, 2, 4, 7, 9],
        "pentatonic_minor": [0, 3, 5, 7, 10],
        "chromatic": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]
    };

    static getPitchLabel(midi: number): string {
        const notes = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
        const octave = Math.floor(midi / 12) - 1;
        const note = notes[midi % 12];
        return `${note}${octave}`;
    }

    static getScaleNotes(min: number, max: number, root: number, scaleName: string): number[] {
        const scaleIntervals = MIDI.scaleTypes[scaleName] || MIDI.scaleTypes["major"];
        const notes: number[] = [];

        // Normalize root to 0-11
        const rootClass = root % 12;

        for (let midi = min; midi <= max; midi++) {
            const noteClass = (midi % 12);
            // Check if noteClass matches any interval from root
            // noteClass = (rootClass + interval) % 12
            // => interval = (noteClass - rootClass + 12) % 12
            const interval = (noteClass - rootClass + 12) % 12;
            if (scaleIntervals.includes(interval)) {
                notes.push(midi);
            }
        }
        return notes;
    }
    /**
     * Create a new MIDI track.
     * @param instant_duration The duration of a single instant in milliseconds.
     * @param instants The MIDI instant sequence.
     */
    constructor(instant_duration: number, duration: number) {
        super()
        this._instant_duration = instant_duration
        this._instants = []
        while (this._instants.length * this.instant_duration < duration) this._instants.push([])
        this._duration = duration
    }

    /**
     * Create an empty MIDI track.
     * @param instant_duration The instant duration in milliseconds.
     * @param duration 
     * @returns 
     */
    static empty(instant_duration: number, duration: number): MIDI {
        return new MIDI(instant_duration, duration)
    }

    /**
     * Create a MIDI track from a string representation.
     * The grind should look like this:
     * `         0 4     0 0
     *    0   0 0         0
     *     0 0
     * `
     * @param str 
     * @param instant_duration 
     * @returns 
     */
    static fromString(str: string, instant_duration: number, high_note = 64): MIDI {
        const lines = str.split("\n")
        let max_length = 0
        for (const line of lines) max_length = Math.max(max_length, line.length)
        const ret = new MIDI(instant_duration, max_length * instant_duration)

        for (let notei = 0; notei < lines.length; notei++) {
            let note = high_note - notei
            for (let instanti = 0; instanti < lines[notei].length; instanti++) {
                const char = lines[notei][instanti]
                if (char < '0' || '9' < char) continue
                const duration = instant_duration * (1 + parseInt(char))
                ret.putNote(new MIDINote(note, 1, 0, duration), instanti * instant_duration)
            }
        }
        return ret
    }

    /**
     * Create a MIDI track from a list of notes.
     * The list contains the note at each instant, or null if there is no note.
     * @param list 
     * @param instant_duration 
     * @returns 
     */
    static fromList(list: (number | null | -1)[], instant_duration: number): MIDI {
        const ret = new MIDI(instant_duration, list.length * instant_duration)
        for (let i = 0; i < list.length; i++) {
            let note = list[i]
            if (note != null) {
                let length = 1
                if (note < MIDI.iii) { note -= MIDI.iiii; length = 5 }
                else if (note < MIDI.ii) { note -= MIDI.iii; length = 4 }
                else if (note < MIDI.i) { note -= MIDI.ii; length = 3 }
                else if (note < 0) { note -= MIDI.i; length = 2 }
                ret.putNote(new MIDINote(note, 1, 0, instant_duration * length), i * instant_duration)
            }
        }
        return ret
    }

    /**
     * Create a MIDI track from a list of notes.
     * @param notes The list of notes.
     * @param instant_duration The instant duration in milliseconds.
     * @param duration The total duration of the MIDI track. If not specified, it will be calculated from the notes.
     */
    static fromNotes(notes: { note: MIDINote, start: number }[], instant_duration: number, duration?: number): MIDI {
        if (duration === undefined) {
            duration = 0
            for (const { note, start } of notes) {
                if (start + note.duration > duration) duration = start + note.duration
            }
        }
        const midi = new MIDI(instant_duration, duration)
        for (const { note, start } of notes) {
            midi.putNote(note, start)
        }
        return midi
    }

    /* Notes */
    static DO = 60
    static DO_ = 61
    static RE = 62
    static RE_ = 63
    static MI = 64
    static FA = 65
    static FA_ = 66
    static SOL = 67
    static SOL_ = 68
    static LA = 69
    static LA_ = 70
    static SI = 71

    static octave_width = 12
    static $ = 12

    static i = -1000
    static ii = -2000
    static iii = -3000
    static iiii = -4000



    /* DURATION */
    private _duration: number = 0

    override get duration(): number {
        return this._duration
    }

    override set duration(value: number) {
        this._duration = value
        const target_count = Math.ceil(this.duration / this.instant_duration)
        while (this._instants.length < target_count) this._instants.push([])
        while (this._instants.length > target_count) this._instants.pop()
    }


    /* INSTANT DURATION */
    private _instant_duration: number

    override get instant_duration(): number {
        return this._instant_duration
    }

    override set instant_duration(value: number) {
        this._instant_duration = value
        this.forEachNote((note, start) => {
            if (start + note.duration > this._duration) this._duration = start + note.duration
        })
    }


    /* INSTANTS */
    private _instants: MIDIInstant[]

    get instants() { return this._instants }

    override get instant_count(): number {
        return this._instants.length
    }

    instantAt(index: number): MIDIInstant {
        return this._instants[index]
    }


    /* PUT NODE / FOR NODE */
    /**
     * Iterate over all notes in the MIDI track.
     * @param callback The callback to call for each note.
     */
    override forEachNote(callback: (note: MIDINote, start: number) => void): void {
        const max_instant_count = Math.min(this.instant_count, Math.ceil(this.duration / this.instant_duration))
        for (let i = 0; i < this.instant_count; i++) {
            const instant = this.instantAt(i)
            for (const note of instant) {
                const start = i * this.instant_duration + note.offset
                if (start >= this.duration) continue
                if (start + note.note.duration > this.duration) callback({ ...note.note, duration: this.duration - start }, start)
                else callback(note.note, start)
            }
        }
    }

    /**
     * Add a note to the MIDI track inside the already existing instants.
     * @param note The note to add.
     * @param start The start time of the note in milliseconds.
     */
    override putNote(note: MIDINote, start: number): void {
        const instant_index = Math.floor(start / this.instant_duration)
        const offset = start - instant_index * this.instant_duration
        if (instant_index >= this.instant_count) return
        const list = this.instantAt(instant_index)
        list.push({ offset, note })
    }


    /**
     * Change the duration and the allocated instants so it can contains all notes and not more.
     */
    pack() {
        let target_duration = 0
        this.forEachNote((note, start) => {
            if (start + note.duration > target_duration) target_duration = start + note.duration
        })
        this.duration = target_duration
    }

    /** SERIALIZATION */

    /**
     * Serialize the MIDI track to a Blob.
     * //TODO Write something more memory efficient.
     */
    save() {
        return new Blob([JSON.stringify({ instants: this._instants, instant_duration: this._instant_duration, duration: this._duration })])
    }

    /**
     * Deserialize a MIDI track from a Blob.
     * //TODO Write something more memory efficient.
     */
    static async load(buffer: ArrayBuffer) {
        const { instants, instant_duration, duration } = JSON.parse(new TextDecoder().decode(buffer)) as { instants: MIDIInstant[], instant_duration: number, duration: number }
        const midi = new MIDI(instant_duration, duration)
        for (let i = 0; i < instants.length; i++)midi.instantAt(i).push(...instants[i])
        return midi
    }

    static load2(buffer: ArrayBuffer): Promise<MIDI | null> {
        return parseSFMMidi(buffer)
    }

    /**
     * Apply glitch effect (chop, delete, merge) to the MIDI track.
     * @param stepMs The grid size in milliseconds.
     * @param deleteChance The probability (0-100) to delete a step.
     * @param mergeChance The probability (0-100) to merge a step with the next.
     * @param start The start time to apply the effect.
     * @param end The end time to apply the effect.
     */
    glitch(stepMs: number, deleteChance: number, mergeChance: number, start: number = 0, end: number = this.duration): MIDI {
        // 1. Slice notes
        const choppedMidi = this.chop(stepMs, start, end);

        if (deleteChance === 0 && mergeChance === 0) return choppedMidi;

        // 2 & 3. Apple Logic (Delete/Merge)
        let allNotes = choppedMidi.notes;

        // Separate Logic Notes (Active Range) vs Preserved Notes
        const insideNotes: { note: MIDINote, start: number }[] = [];
        const outsideNotes: { note: MIDINote, start: number }[] = [];

        // Identify grid slots to reconstruct logic
        const getStepIndex = (time: number) => Math.floor((time - start + 0.1) / stepMs);

        const notesByStep: { [key: number]: { note: MIDINote, start: number }[] } = {};
        const steps: number[] = [];

        allNotes.forEach(item => {
            // Check if item is within process range
            if (item.start >= start - 0.1 && item.start < end - 0.1) {
                insideNotes.push(item);
                const stepIdx = getStepIndex(item.start);
                if (!notesByStep[stepIdx]) {
                    notesByStep[stepIdx] = [];
                    steps.push(stepIdx);
                }
                notesByStep[stepIdx].push(item);
            } else {
                outsideNotes.push(item);
            }
        });

        steps.sort((a, b) => a - b);

        const deletedSteps = new Set<number>();
        const mergedSteps = new Set<number>();

        // Apply Delete
        steps.forEach(step => {
            if (Math.random() * 100 < deleteChance) {
                deletedSteps.add(step);
            }
        });

        // Apply Merge
        for (let i = 0; i < steps.length - 1; i++) {
            const currentStep = steps[i];
            const nextStep = steps[i + 1];

            // Only merge adjacent steps
            if (nextStep !== currentStep + 1) continue;

            if (!deletedSteps.has(currentStep) && !deletedSteps.has(nextStep)) {
                if (Math.random() * 100 < mergeChance) {
                    mergedSteps.add(currentStep);
                }
            }
        }

        // Reconstruct
        const finalNotes = [...outsideNotes];
        const consumedNotes = new Set<{ note: MIDINote, start: number }>();

        steps.forEach(step => {
            if (deletedSteps.has(step)) return;

            const stepNotes = notesByStep[step];
            if (!stepNotes) return;

            const isMerging = mergedSteps.has(step);
            const nextStepNotes = notesByStep[step + 1];

            stepNotes.forEach(item => {
                if (consumedNotes.has(item)) return;

                if (isMerging && nextStepNotes) {
                    // Try Merge
                    const match = nextStepNotes.find(n =>
                        !consumedNotes.has(n) &&
                        n.note.note === item.note.note &&
                        Math.abs((item.start + item.note.duration) - n.start) < 1
                    );

                    if (match) {
                        // Merge logic
                        const newNote = new MIDINote(item.note.note, item.note.velocity, item.note.channel, item.note.duration + match.note.duration);
                        const newItem = { note: newNote, start: item.start };

                        consumedNotes.add(match);

                        // Replace match in next step to allow chain merging
                        const matchIdx = nextStepNotes.indexOf(match);
                        nextStepNotes[matchIdx] = newItem;
                    } else {
                        finalNotes.push(item);
                    }
                } else {
                    finalNotes.push(item);
                }
            });
        });

        return MIDI.fromNotes(finalNotes, this.instant_duration);
    }

}

/**
 * A view of a MIDI track, abstracting the way the MIDI track is stored.
 * You can get all instants and the instant duration.
 * The duration of the track is at the end of note that ends the latest.
 * /!\ Any modification on the original midi can invalid its sub midis.
 */
export class SubMIDI extends MIDIView {

    public readonly sub_instant_start
    public readonly sub_instant_count
    public readonly subduration


    constructor(public readonly decorated: MIDIView, public readonly substart: number, subduration?: number) {
        super()
        if (!subduration) subduration = decorated.duration - substart
        this.subduration = subduration
        this.sub_instant_start = Math.floor(this.substart / decorated.instant_duration)
        this.sub_instant_count = Math.ceil(subduration / decorated.instant_duration)
    }

    /* DURATION */
    override get duration(): number {
        return this.subduration
    }

    /** The duration of a single instant in milliseconds. */
    get instant_duration() { return this.decorated.instant_duration }

    /** The number of instants in the MIDI track. */
    get instant_count() { return this.decorated.instant_count }

    /**
     * Iterate over all notes in the MIDI track.
     * @param callback The callback to call for each note.
     */
    override forEachNote(callback: (note: MIDINote, start: number) => void): void {
        this.decorated.forEachNote((note, start) => {
            const newstart = start - this.substart
            if (newstart >= 0 && newstart <= this.duration) callback(note, start - this.substart)
        })
    }

    /**
     * Add a note to the MIDI track inside the already existing instants.
     * @param note The note to add.
     * @param start The start time of the note in milliseconds.
     */
    override putNote(note: MIDINote, start: number): void {
        if (start < this.duration) this.decorated.putNote(note, start + this.substart)
    }


}

export class MIDIBuilder {

    private notes: { note: MIDINote, start: number }[] = []
    private duration = 0

    addNote(note: MIDINote, start: number) {
        this.notes.push({ note, start })
        if (start + note.duration > this.duration) this.duration = start + note.duration
    }

    build(): MIDI {
        const ret = new MIDI(this.duration, this.duration)
        for (const { note, start } of this.notes) {
            ret.putNote(note, start)
        }
        return ret.optimized()
    }

}

/**
 * A MIDI builder that can accumulate notes and build a MIDI track by calling noteOn and noteOff in sequence.
 */
export class MIDIAccumulator {

    private closed_notes: { note: MIDINote, start: number }[] = []
    private open_notes: { [key: number]: { note: number, velocity: number, start: number } } = []
    private duration = 0


    /**
     * Start a new note at a given time.
     * @param note The note as MIDI note, an integer between 0 and 128.
     * @param channel The MIDI channel, an integer between 0 and 16.
     * @param velocity The note velocity, between 0 and 1.
     * @param start The start time of the note in milliseconds.
     */
    noteOn(note: number, channel: number, velocity: number, start: number) {
        const id = note + channel * 128
        this.open_notes[id] = { note, velocity, start }
    }

    /**
     * Stop a new note at a given time.
     * @param note The note as MIDI note, an integer between 0 and 128.
     * @param channel The MIDI channel, an integer between 0 and 16.
     * @param end The end time of the note in milliseconds.
     */
    noteOff(note: number, channel: number, end: number) {
        const id = note + channel * 128
        const open_note = this.open_notes[id]
        if (open_note !== undefined) {
            if (end > this.duration) this.duration = end
            this.closed_notes.push({ note: new MIDINote(note, open_note.velocity, channel, end - open_note.start), start: open_note.start })
            delete this.open_notes[id]
        }
    }

    /**
     * The number of closed notes, the number of notes with a defined end.
     * @returns The number of closed notes.
     */
    get closedCount() {
        return this.closed_notes.length
    }

    /**
     * The number of open notes, the number of notes without a defined end.
     * @returns The number of open notes.
     */
    get openCount() {
        return Object.keys(this.open_notes).length
    }



    /**
     * Return a new MIDI track with all the notes.
     * Only the notes with a defined end are kept.
     * @returns 
     */
    build(): MIDI {
        const ret = new MIDI(this.duration, this.duration)
        for (const { note, start } of this.closed_notes) {
            ret.putNote(note, start)
        }
        return ret.optimized()
    }

    /**
     * Remove all the closed notes, the notes with a defined end.
     */
    clearClosed() {
        this.open_notes = {}
    }
}