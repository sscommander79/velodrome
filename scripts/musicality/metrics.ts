// Musicality proxy metrics. These cannot measure "good music", but they
// reliably measure "boring": repetition, absence of rests, flat dynamics,
// flat contour. Used as a regression gate for each build cycle.
import type { Midi } from '@tonejs/midi';
import type { MidiConfig } from '../../src/lib/types';

const SCALE_INTERVALS: Record<string, number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  pentatonic: [0, 2, 4, 7, 9],
};

const KEY_OFFSETS: Record<string, number> = {
  C: 0, Db: 1, D: 2, Eb: 3, E: 4, F: 5,
  'F#': 6, G: 7, Ab: 8, A: 9, Bb: 10, B: 11,
};

interface SimpleNote {
  midi: number;
  time: number;
  duration: number;
  velocity: number;
}

function entropyBits(counts: Map<string | number, number>): number {
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  if (total === 0) return 0;
  let h = 0;
  for (const c of counts.values()) {
    const p = c / total;
    h -= p * Math.log2(p);
  }
  return h;
}

function tally<T extends string | number>(values: T[]): Map<T, number> {
  const m = new Map<T, number>();
  for (const v of values) m.set(v, (m.get(v) ?? 0) + 1);
  return m;
}

function std(values: number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, v) => a + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

/** Fraction of total span not covered by any note (merged intervals). */
function restRatio(notes: SimpleNote[], spanSec: number): number {
  if (notes.length === 0 || spanSec <= 0) return 1;
  const intervals = notes
    .map((n) => [n.time, n.time + n.duration] as [number, number])
    .sort((a, b) => a[0] - b[0]);
  let covered = 0;
  let [curStart, curEnd] = intervals[0];
  for (const [s, e] of intervals.slice(1)) {
    if (s <= curEnd) {
      curEnd = Math.max(curEnd, e);
    } else {
      covered += curEnd - curStart;
      [curStart, curEnd] = [s, e];
    }
  }
  covered += curEnd - curStart;
  return Math.max(0, 1 - covered / spanSec);
}

/** Fraction of 4-note pitch sequences that already occurred earlier. */
function fourGramRepeatRate(pitches: number[]): number {
  if (pitches.length < 8) return 0;
  const seen = new Set<string>();
  let repeats = 0;
  let total = 0;
  for (let i = 0; i + 4 <= pitches.length; i++) {
    const gram = pitches.slice(i, i + 4).join(',');
    if (seen.has(gram)) repeats++;
    else seen.add(gram);
    total++;
  }
  return repeats / total;
}

/**
 * Mean cosine similarity of pitch histograms between adjacent time windows.
 * 1.0 = every window sounds identical (drone); near 0 = no continuity (noise).
 * Musical output should sit in between.
 */
function adjacentWindowSimilarity(notes: SimpleNote[], spanSec: number, windows = 16): number {
  if (notes.length === 0 || spanSec <= 0) return 1;
  const hists: Map<number, number>[] = Array.from({ length: windows }, () => new Map());
  for (const n of notes) {
    const w = Math.min(windows - 1, Math.floor((n.time / spanSec) * windows));
    hists[w].set(n.midi, (hists[w].get(n.midi) ?? 0) + 1);
  }
  const sims: number[] = [];
  for (let i = 0; i + 1 < windows; i++) {
    const a = hists[i];
    const b = hists[i + 1];
    if (a.size === 0 || b.size === 0) continue;
    let dot = 0;
    let magA = 0;
    let magB = 0;
    for (const [k, v] of a) {
      magA += v * v;
      dot += v * (b.get(k) ?? 0);
    }
    for (const v of b.values()) magB += v * v;
    sims.push(dot / (Math.sqrt(magA) * Math.sqrt(magB)));
  }
  return sims.length ? sims.reduce((x, y) => x + y, 0) / sims.length : 1;
}

/**
 * Std of gate length (note duration / inter-onset interval) across the track.
 * Note-length variety, independent of tempo: ~0 = every note the same relative
 * length (what the fixed 0.45/0.8/0.95 articulation produces now), higher = a
 * living mix of short stabs and sustained notes.
 */
function gateLengthStd(notes: SimpleNote[]): number {
  const sorted = [...notes].sort((a, b) => a.time - b.time);
  const gates: number[] = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const ioi = sorted[i + 1].time - sorted[i].time;
    if (ioi > 1e-6) gates.push(sorted[i].duration / ioi);
  }
  return std(gates);
}

/**
 * Microtiming / swing. Looks only at consecutive inter-onset intervals that are
 * meant to be the SAME length (ratio within 15%) — a locally-uniform run. On
 * quantized output those pairs are exactly equal, so the metric is 0. Real
 * microtiming perturbs onsets and breaks the equality; measured as mean
 * |IOI[i]-IOI[i-1]| / mean-IOI over such pairs. Rhythmic syncopation (a genuine
 * change of gap) and per-phrase tempo changes are excluded because their IOI
 * ratio exceeds the threshold, so they do not masquerade as jitter.
 */
function offGridDeviation(notes: SimpleNote[]): number {
  const times = notes.map((n) => n.time).sort((a, b) => a - b);
  const iois: number[] = [];
  for (let i = 1; i < times.length; i++) {
    const d = times[i] - times[i - 1];
    if (d > 1e-6) iois.push(d);
  }
  const devs: number[] = [];
  for (let i = 1; i < iois.length; i++) {
    const a = iois[i - 1];
    const b = iois[i];
    const ratio = a > b ? a / b : b / a;
    if (ratio <= 1.15) devs.push(Math.abs(b - a) / ((a + b) / 2));
  }
  return devs.length ? devs.reduce((x, y) => x + y, 0) / devs.length : 0;
}

export interface TrackMetrics {
  noteCount: number;
  uniquePitches: number;
  pitchEntropyBits: number;
  topPitchDominance: number;      // fraction of notes on the single most common pitch
  consecutiveRepeatRate: number;  // adjacent same-pitch pairs / all pairs
  fourGramRepeatRate: number;
  intervalStatic: number;         // fraction of 0-semitone moves
  intervalStep: number;           // 1-2 semitones
  intervalLeap: number;           // >2 semitones
  restRatio: number;
  velocityStd: number;
  ioiEntropyBits: number;         // inter-onset-interval variety
  adjacentWindowSimilarity: number;
  gateLengthStd: number;          // note-length variety (duration / IOI spread)
  offGridDeviation: number;       // microtiming: onset deviation from local grid
  inScaleRate: number;            // guardrail: must stay ~1.0
}

function emptyTrackMetrics(): TrackMetrics {
  return {
    noteCount: 0,
    uniquePitches: 0,
    pitchEntropyBits: 0,
    topPitchDominance: 0,
    consecutiveRepeatRate: 0,
    fourGramRepeatRate: 0,
    intervalStatic: 0,
    intervalStep: 0,
    intervalLeap: 0,
    restRatio: 1,
    velocityStd: 0,
    ioiEntropyBits: 0,
    adjacentWindowSimilarity: 1,
    gateLengthStd: 0,
    offGridDeviation: 0,
    inScaleRate: 1,
  };
}

function trackMetrics(
  midi: Midi,
  config: MidiConfig,
  spanSec: number,
  selectTrack: (midi: Midi) => Midi['tracks'][number] | undefined
): TrackMetrics {
  const track = selectTrack(midi);
  if (!track) return emptyTrackMetrics();

  const notes: SimpleNote[] = track.notes.map((n) => ({
    midi: n.midi,
    time: n.time,
    duration: n.duration,
    velocity: n.velocity,
  }));
  const pitches = notes.map((n) => n.midi);

  const pitchCounts = tally(pitches);
  const topCount = Math.max(0, ...pitchCounts.values());

  let repeats = 0;
  const intervals = { static: 0, step: 0, leap: 0 };
  for (let i = 1; i < pitches.length; i++) {
    const d = Math.abs(pitches[i] - pitches[i - 1]);
    if (d === 0) {
      repeats++;
      intervals.static++;
    } else if (d <= 2) {
      intervals.step++;
    } else {
      intervals.leap++;
    }
  }
  const pairs = Math.max(1, pitches.length - 1);

  const iois: number[] = [];
  for (let i = 1; i < notes.length; i++) {
    iois.push(Math.round((notes[i].time - notes[i - 1].time) * 200) / 200); // 5ms bins
  }

  const scaleSet = new Set(
    SCALE_INTERVALS[config.mode].map((iv) => (iv + KEY_OFFSETS[config.key]) % 12)
  );
  const inScale = pitches.filter((p) => scaleSet.has(p % 12)).length;

  return {
    noteCount: notes.length,
    uniquePitches: pitchCounts.size,
    pitchEntropyBits: entropyBits(pitchCounts),
    topPitchDominance: notes.length ? topCount / notes.length : 0,
    consecutiveRepeatRate: repeats / pairs,
    fourGramRepeatRate: fourGramRepeatRate(pitches),
    intervalStatic: intervals.static / pairs,
    intervalStep: intervals.step / pairs,
    intervalLeap: intervals.leap / pairs,
    restRatio: restRatio(notes, spanSec),
    velocityStd: std(notes.map((n) => n.velocity)),
    ioiEntropyBits: entropyBits(tally(iois)),
    adjacentWindowSimilarity: adjacentWindowSimilarity(notes, spanSec),
    gateLengthStd: gateLengthStd(notes),
    offGridDeviation: offGridDeviation(notes),
    inScaleRate: notes.length ? inScale / notes.length : 1,
  };
}

export function melodicMetrics(midi: Midi, config: MidiConfig, spanSec: number): TrackMetrics {
  return trackMetrics(midi, config, spanSec, (m) => m.tracks.find((t) => t.channel !== 9) ?? m.tracks[0]);
}

export function harmonyMetrics(midi: Midi, config: MidiConfig, spanSec: number): TrackMetrics {
  return trackMetrics(midi, config, spanSec, (m) => m.tracks.find((t) => t.name === 'Harmony (Gradient)'));
}

export interface PercMetrics {
  noteCount: number;
  uniqueInstruments: number;
  velocityStd: number;
  ioiEntropyBits: number;
  restRatio: number;
  offGridDeviation: number;       // microtiming / swing on the drum grid
}

export function percussionMetrics(midi: Midi, spanSec: number): PercMetrics {
  const track = midi.tracks.find((t) => t.channel === 9);
  if (!track) {
    return { noteCount: 0, uniqueInstruments: 0, velocityStd: 0, ioiEntropyBits: 0, restRatio: 1, offGridDeviation: 0 };
  }
  const notes: SimpleNote[] = track.notes.map((n) => ({
    midi: n.midi,
    time: n.time,
    duration: n.duration,
    velocity: n.velocity,
  }));
  const iois: number[] = [];
  const sorted = [...notes].sort((a, b) => a.time - b.time);
  for (let i = 1; i < sorted.length; i++) {
    iois.push(Math.round((sorted[i].time - sorted[i - 1].time) * 200) / 200);
  }
  return {
    noteCount: notes.length,
    uniqueInstruments: tally(notes.map((n) => n.midi)).size,
    velocityStd: std(notes.map((n) => n.velocity)),
    ioiEntropyBits: entropyBits(tally(iois)),
    restRatio: restRatio(notes, spanSec),
    offGridDeviation: offGridDeviation(notes),
  };
}
