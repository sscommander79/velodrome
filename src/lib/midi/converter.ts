import { Midi } from '@tonejs/midi';
import { NormalizedRide, MidiConfig, ConversionResult } from '../types';
import {
  buildScaleNotes,
  elevationToPitch,
  speedToBpm,
  heartRateToVelocity,
} from './scales';
import { euclideanPattern } from './euclidean';

const PHRASE_BARS = 4;
const BEATS_PER_BAR = 4;
const PHRASE_BEATS = PHRASE_BARS * BEATS_PER_BAR;

const PERC_HIHAT_CLOSED = 42;
const PERC_HIHAT_OPEN = 46;
const PERC_KICK = 36;
const PERC_SNARE = 38;

const YIELD_EVERY = 50;
const STEPS_PER_BAR = 16;

function averageOf(arr: number[], start: number, end: number): number {
  const slice = arr.slice(start, end);
  if (slice.length === 0) return 0;
  return slice.reduce((a, b) => a + b, 0) / slice.length;
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

export async function convertToMidi(
  ride: NormalizedRide,
  config: MidiConfig,
  onProgress?: (progress: number) => void
): Promise<ConversionResult> {
  const { points } = ride;
  if (points.length === 0) {
    throw new Error('No data points to convert');
  }

  const scaleNotes = buildScaleNotes(config.key, config.mode);

  // Hoist per-field arrays out of the phrase loop below — rebuilding these
  // inside the loop was O(phrases × points) allocations.
  const cadences = points.map((p) => p.cadence);
  const altitudes = points.map((p) => p.altitude);
  const heartRates = points.map((p) => p.heartRate);
  const powers = points.map((p) => p.power);

  // Reduce instead of Math.min(...spread): the spread form throws
  // "Maximum call stack size exceeded" on very long rides (tens of thousands
  // of per-second points).
  let minAlt = Infinity;
  let maxAlt = -Infinity;
  let minHr = Infinity;
  let maxHr = -Infinity;
  let maxPower = -Infinity;
  for (let k = 0; k < points.length; k++) {
    const a = altitudes[k];
    const h = heartRates[k];
    const p = powers[k];
    if (a < minAlt) minAlt = a;
    if (a > maxAlt) maxAlt = a;
    if (h < minHr) minHr = h;
    if (h > maxHr) maxHr = h;
    if (p > maxPower) maxPower = p;
  }
  if (!Number.isFinite(maxPower) || maxPower <= 0) maxPower = 1;

  const midi = new Midi();

  const melodicTrack = midi.addTrack();
  melodicTrack.name = 'Melody (Elevation)';

  const percTrack = midi.addTrack();
  percTrack.name = 'Rhythm (Cadence)';
  percTrack.channel = 9;

  let currentTimeSec = 0;
  let noteCount = 0;
  let minBpmSeen = config.tempoMax;
  let maxBpmSeen = config.tempoMin;

  const SENSITIVITY = Math.max(0.1, Math.min(1, config.rhythmicSensitivity));

  let i = 0;
  let phraseCount = 0;

  while (i < points.length) {
    if (phraseCount % YIELD_EVERY === 0) {
      onProgress?.(i / points.length);
      await yieldToEventLoop();
    }
    phraseCount++;

    const bpm = speedToBpm(points[i].speed, config.tempoMin, config.tempoMax);
    minBpmSeen = Math.min(minBpmSeen, bpm);
    maxBpmSeen = Math.max(maxBpmSeen, bpm);

    const beatDurationSec = 60 / bpm;
    const phraseDurationSec = PHRASE_BEATS * beatDurationSec;

    const secondsPerPoint =
      i < points.length - 1
        ? Math.max(0.1, (points[i + 1].timestamp - points[i].timestamp) / 1000)
        : 1;

    const pointsInPhrase = Math.max(1, Math.round(phraseDurationSec / secondsPerPoint));
    const phraseEnd = Math.min(i + pointsInPhrase, points.length);

    const avgCadence = averageOf(cadences, i, phraseEnd);
    const avgAlt = averageOf(altitudes, i, phraseEnd);
    const avgHr = averageOf(heartRates, i, phraseEnd);
    const avgPower = averageOf(powers, i, phraseEnd);

    const smoothedCadence = Math.max(
      30,
      Math.min(130, avgCadence * SENSITIVITY + 80 * (1 - SENSITIVITY))
    );

    const pitch = elevationToPitch(avgAlt, minAlt, maxAlt, scaleNotes);
    const velocity = heartRateToVelocity(avgHr, minHr, maxHr);

    const stepDurationSec = beatDurationSec / 4;
    const barDurationSec = beatDurationSec * BEATS_PER_BAR;
    const pulses = clamp(Math.round(3 + ((smoothedCadence - 30) / 100) * 9), 3, 12);
    const powerNorm = clamp(avgPower / maxPower, 0, 1);
    const rotation = Math.round(powerNorm * 3);
    const pattern = euclideanPattern(pulses, STEPS_PER_BAR, rotation);
    const phraseEndTimeSec = currentTimeSec + phraseDurationSec;
    const barsInPhrase = Math.ceil(phraseDurationSec / barDurationSec);

    for (let bar = 0; bar < barsInPhrase; bar++) {
      const barStartTime = currentTimeSec + bar * barDurationSec;
      for (let step = 0; step < STEPS_PER_BAR; step++) {
        const noteTime = barStartTime + step * stepDurationSec;
        if (noteTime >= phraseEndTimeSec - 1e-9) break;
        if (!pattern[step]) continue;
        melodicTrack.addNote({
          midi: pitch,
          time: noteTime,
          duration: Math.min(stepDurationSec * 0.8, phraseEndTimeSec - noteTime),
          velocity,
        });
        noteCount++;
      }
    }

    addPercussionPhrase(
      percTrack,
      currentTimeSec,
      phraseDurationSec,
      smoothedCadence,
      bpm,
      avgPower,
      avgHr,
      maxHr
    );

    currentTimeSec += phraseDurationSec;
    i = phraseEnd;
  }

  onProgress?.(1);

  const midiArray = midi.toArray();
  const midiBytes = midiArray instanceof Uint8Array ? midiArray : new Uint8Array(midiArray);

  return {
    midiBytes,
    noteCount,
    durationSeconds: currentTimeSec,
    bpmRange: [minBpmSeen, maxBpmSeen],
  };
}

function addPercussionPhrase(
  track: ReturnType<Midi['addTrack']>,
  startTime: number,
  phraseDuration: number,
  cadenceRpm: number,
  bpm: number,
  power: number,
  avgHr: number,
  maxHr: number
): void {
  const beatDuration = 60 / bpm;
  const numBeats = Math.floor(phraseDuration / beatDuration);

  const hihatInterval = cadenceRpm > 0 ? 60 / cadenceRpm : beatDuration;
  const hihatNote = cadenceRpm > 80 ? PERC_HIHAT_CLOSED : PERC_HIHAT_OPEN;
  const hihatVel = Math.min(0.9, 0.5 + (cadenceRpm / 130) * 0.4);
  const kickVel = Math.min(0.95, 0.6 + (power / 500) * 0.3);
  const snareVel = 0.55;

  let hihatTime = startTime;
  while (hihatTime < startTime + phraseDuration - 0.01) {
    track.addNote({
      midi: hihatNote,
      time: hihatTime,
      duration: 0.05,
      velocity: hihatVel,
    });
    hihatTime += hihatInterval;
  }

  for (let beat = 0; beat < numBeats; beat++) {
    const beatTime = startTime + beat * beatDuration;
    if (beat % 2 === 0) {
      track.addNote({
        midi: PERC_KICK,
        time: beatTime,
        duration: 0.1,
        velocity: kickVel,
      });
    }
    if (beat % 2 === 1) {
      track.addNote({
        midi: PERC_SNARE,
        time: beatTime,
        duration: 0.08,
        velocity: snareVel,
      });
    }
  }

  void avgHr; void maxHr;
}
