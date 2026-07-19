import { Midi } from '@tonejs/midi';

export interface MidiTrackExport {
  name: string;
  bytes: Uint8Array;
}

const DRUM_CHANNEL = 9;
const SYNTH_TRACK_NAME = 'Merged Synth';
const DRUM_TRACK_NAME = 'Drums';

interface NoteFields {
  midi: number;
  ticks: number;
  durationTicks: number;
  velocity: number;
  noteOffVelocity: number;
}

function createMidiWithSourceHeader(source: Midi): Midi {
  const midi = new Midi();
  midi.header.fromJSON(source.header.toJSON());
  return midi;
}

function toBytes(midi: Midi): Uint8Array {
  const bytes = midi.toArray();
  return bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
}

function addTrackNotes(target: ReturnType<Midi['addTrack']>, source: Midi['tracks'][number]): void {
  target.name = source.name;
  target.channel = source.channel;
  target.instrument.fromJSON(source.instrument.toJSON());

  addNotes(target, source.notes);
}

function noteFields(note: NoteFields): NoteFields {
  return {
    midi: note.midi,
    ticks: note.ticks,
    durationTicks: note.durationTicks,
    velocity: note.velocity,
    noteOffVelocity: note.noteOffVelocity,
  };
}

function addNotes(target: ReturnType<Midi['addTrack']>, notes: NoteFields[]): void {
  for (const note of notes) {
    target.addNote(noteFields(note));
  }
}

export function splitTracks(midiBytes: Uint8Array): MidiTrackExport[] {
  const source = new Midi(midiBytes);

  return source.tracks.map((track, index) => {
    const midi = createMidiWithSourceHeader(source);
    const singleTrack = midi.addTrack();
    addTrackNotes(singleTrack, track);

    return {
      name: track.name || `Track ${index + 1}`,
      bytes: toBytes(midi),
    };
  });
}

export function mergeToSingleTrack(midiBytes: Uint8Array): Uint8Array {
  const source = new Midi(midiBytes);
  const midi = createMidiWithSourceHeader(source);
  const synthTrack = midi.addTrack();
  synthTrack.name = SYNTH_TRACK_NAME;
  synthTrack.channel = 0;

  const drumTrack = midi.addTrack();
  drumTrack.name = DRUM_TRACK_NAME;
  drumTrack.channel = DRUM_CHANNEL;

  const synthNotes = source.tracks
    .filter((track) => track.channel !== DRUM_CHANNEL)
    .flatMap((track) => track.notes.map(noteFields))
    .sort((a, b) => a.ticks - b.ticks);
  const drumNotes = source.tracks
    .filter((track) => track.channel === DRUM_CHANNEL)
    .flatMap((track) => track.notes.map(noteFields))
    .sort((a, b) => a.ticks - b.ticks);

  addNotes(synthTrack, synthNotes);
  addNotes(drumTrack, drumNotes);

  return toBytes(midi);
}
