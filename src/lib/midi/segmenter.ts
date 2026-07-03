import { NormalizedRide, MidiConfig, MusicalKey, MusicalMode } from "@/lib/types";
import { euclideanPattern } from "./euclidean";

export interface StepData {
  note: number;      // MIDI note 0-127
  velocity: number;  // 0-127
  length: number;    // 0-127 (Elektron: 0=1/128, 127=128/128 of a step)
  active: boolean;   // false = rest/no trig
}

const SCALE_INTERVALS: Record<MusicalMode, number[]> = {
  major:      [0, 2, 4, 5, 7, 9, 11],
  minor:      [0, 2, 3, 5, 7, 8, 10],
  pentatonic: [0, 2, 4, 7, 9],
};

const KEY_OFFSETS: Record<MusicalKey, number> = {
  C: 0, Db: 1, D: 2, Eb: 3, E: 4, F: 5,
  'F#': 6, G: 7, Ab: 8, A: 9, Bb: 10, B: 11,
};

function quantizeToScale(rawNote: number, key: MusicalKey, mode: MusicalMode): number {
  const intervals = SCALE_INTERVALS[mode];
  const keyOffset = KEY_OFFSETS[key];
  const octave = Math.floor(rawNote / 12);
  const semitone = rawNote % 12;
  const relative = (semitone - keyOffset + 12) % 12;
  let closest = intervals[0];
  let minDist = 12;
  for (const interval of intervals) {
    const dist = Math.min(Math.abs(interval - relative), 12 - Math.abs(interval - relative));
    if (dist < minDist) { minDist = dist; closest = interval; }
  }
  return Math.min(127, Math.max(0, octave * 12 + keyOffset + closest));
}

function clamp(val: number, min: number, max: number) {
  return Math.max(min, Math.min(max, val));
}

function median(arr: number[]): number {
  if (!arr.length) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function mean(arr: number[]): number {
  if (!arr.length) return 0;
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

export function segmentRide(
  ride: NormalizedRide,
  stepCount: number,
  config: MidiConfig,
): StepData[] {
  const points = ride.points;
  if (!points.length) return Array(stepCount).fill({ note: 60, velocity: 64, length: 96, active: false });

  const sliceSize = Math.max(1, Math.floor(points.length / stepCount));

  const altitudes = points.map(p => p.altitude);
  const altMin = Math.min(...altitudes);
  const altMax = Math.max(...altitudes);
  const altRange = Math.max(1, altMax - altMin);

  const speeds = points.map(p => p.speed);
  const speedMin = Math.min(...speeds);
  const speedMax = Math.max(...speeds);
  const speedRange = Math.max(1, speedMax - speedMin);

  const cadences = points.map(p => p.cadence);
  const powers = points.map(p => p.power);
  const rideMeanCadence = mean(cadences);
  const rideMeanPower = mean(powers);
  const maxPower = Math.max(1, ...powers);
  const k = clamp(Math.round(3 + ((rideMeanCadence - 30) / 100) * 9), 6, 12);
  const rotation = Math.round(clamp(rideMeanPower / maxPower, 0, 1) * 3);
  const activeMask = euclideanPattern(k, 16, rotation);

  const steps: StepData[] = [];

  for (let i = 0; i < stepCount; i++) {
    const start = i * sliceSize;
    const end = i === stepCount - 1 ? points.length : Math.min(start + sliceSize, points.length);
    const slice = points.slice(start, end);

    const avgAlt = median(slice.map(p => p.altitude));
    const avgSpeed = mean(slice.map(p => p.speed));
    const avgCadence = mean(slice.map(p => p.cadence));

    const altNorm = (avgAlt - altMin) / altRange;
    const rawNote = Math.round(36 + altNorm * 36);
    const note = clamp(quantizeToScale(rawNote, config.key, config.mode), 16, 84);

    const speedNorm = (avgSpeed - speedMin) / speedRange;
    const velocity = clamp(Math.round(40 + speedNorm * 87), 1, 127);

    const active = avgCadence > 20 && activeMask[i % 16];

    // Elektron step length: 0x00=1/128, 0x18=1/8, 0x30=1/4, 0x60=1/2, 0x7F=full
    const cadenceNorm = (clamp(avgCadence, 30, 130) - 30) / 100;
    const length = clamp(Math.round(0x20 + cadenceNorm * (0x7f - 0x20)), 0x20, 0x7f);

    steps.push({ note, velocity, length, active });
  }

  return steps;
}
