
import { WebAudioModule } from "@webaudiomodules/sdk"
import { MIDI } from "../../MIDI/MIDI"
import BaseAudioPlayerNode from "../BaseAudioPlayerNode"

/**
 * A player node for MIDI files.
 * Can play MIDI files with the given instants and instant_duration.
 * @author Samuel DEMONT
 */
export default class MIDIPlayerNode extends BaseAudioPlayerNode {

    constructor(module: WebAudioModule<MIDIPlayerNode>) {
        super(module, {
            numberOfInputs: 1,
            numberOfOutputs: 1,
            outputChannelCount: [2]
        })
    }

    setMidi(midi: MIDI | undefined): Promise<void> {
        if (midi) return this.postMessageAsync({ instants: midi.instants, instant_duration: midi.instant_duration })
        else return this.postMessageAsync({ instants: undefined })
    }

    /**
     * Override to handle messages from the processor
     */
    override async _onMessage(e: MessageEvent) {
        await super._onMessage(e);

        if (e.data && e.data.type === 'midi_out_trigger') {
            const { channel, note, velocity, duration } = e.data;
            this.handleExternalMidi(channel, note, velocity, duration);
        }
    }

    private handleExternalMidi(channel: number, note: number, velocity: number, duration: number) {
        // Dynamic import or global access to MidiOutputController?
        // We set up a static instance access.
        // @ts-ignore
        import("../../../Controllers/MidiOutputController").then(({ default: MidiOutputController }) => {
            const controller = MidiOutputController.instance;
            if (!controller) return;

            // Note On
            controller.send([0x90 | channel, note, velocity]);

            // Schedule Note Off
            setTimeout(() => {
                controller.send([0x80 | channel, note, 0]);
            }, duration);
        }).catch(err => {
            // Avoid crashing audio thread if import fails
            // console.error(err);
        });
    }
}