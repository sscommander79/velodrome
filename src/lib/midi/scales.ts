import { MusicalKey, MusicalMode } from '../types';

const KEY_ROOT_MIDI: Record<MusicalKey, number> = {
  C: 60, Db: 61, D: 62, Eb: 63, E: 64, F: 65,
  'F#': 66, G: 67, Ab: 68, A: 69, Bb: 70, B: 71,
};

const SCALE_INTERVALS: Record<MusicalMode, number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  pentatonic: [0, 2, 4, 7, 9],
};

export function buildScaleNotes(key: MusicalKey, mode: MusicalMode): number[] {
  const root = KEY_ROOT_MIDI[key];
  const intervals = SCALE_INTERVALS[mode];
  const notes: number[] = [];
  for (let octave = -2; octave <= 4; octave++) {
    for (const interval of intervals) {
      const note = root + interval + octave * 12;
      if (note >= 36 && note <= 96) {
        notes.push(note);
      }
    }
  }
  return notes.sort((a, b) => a - b);
}

export function quantizePitch(value: number, scaleNotes: number[]): number {
  if (scaleNotes.length === 0) return 60;
  let closest = scaleNotes[0];
  let minDist = Math.abs(value - scaleNotes[0]);
  for (const note of scaleNotes) {
    const dist = Math.abs(value - note);
    if (dist < minDist) {
      minDist = dist;
      closest = note;
    }
  }
  return closest;
}

export function elevationToPitch(
  elevation: number,
  minElevation: number,
  maxElevation: number,
  scaleNotes: number[]
): number {
  if (maxElevation === minElevation) {
    return scaleNotes[Math.floor(scaleNotes.length / 2)];
  }
  const normalized = (elevation - minElevation) / (maxElevation - minElevation);
  const lowestNote = scaleNotes[0];
  const highestNote = scaleNotes[scaleNotes.length - 1];
  const rawPitch = lowestNote + normalized * (highestNote - lowestNote);
  return quantizePitch(rawPitch, scaleNotes);
}

export type NoteDurationName =
  | 'whole' | 'half' | 'quarter' | 'eighth' | 'sixteenth' | 'thirtysecond';

export function cadenceToNoteDuration(cadenceRpm: number): NoteDurationName {
  if (cadenceRpm >= 110) return 'thirtysecond';
  if (cadenceRpm >= 90)  return 'sixteenth';
  if (cadenceRpm >= 70)  return 'eighth';
  if (cadenceRpm >= 55)  return 'quarter';
  if (cadenceRpm >= 40)  return 'half';
  return 'whole';
}

export function noteDurationToBeats(name: NoteDurationName): number {
  switch (name) {
    case 'thirtysecond': return 0.125;
    case 'sixteenth':    return 0.25;
    case 'eighth':       return 0.5;
    case 'quarter':      return 1.0;
    case 'half':         return 2.0;
    case 'whole':        return 4.0;
  }
}

export function speedToBpm(speedMs: number, minBpm: number, maxBpm: number): number {
  const speedKmh = speedMs * 3.6;
  const normalized = Math.max(0, Math.min(1, (speedKmh - 5) / (50 - 5)));
  const bpm = minBpm + normalized * (maxBpm - minBpm);
  return Math.round(bpm);
}

export function heartRateToVelocity(heartRate: number, minHr = 60, maxHr = 185): number {
  const normalized = Math.max(0, Math.min(1, (heartRate - minHr) / (maxHr - minHr)));
  return 0.4 + normalized * 0.55;
}
