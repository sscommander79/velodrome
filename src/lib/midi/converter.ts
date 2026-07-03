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
  const speeds = points.map((p) => p.speed);
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

  // Emit one 4-bar phrase for the point slice [start, end) at the given BPM.
  // Shared by both drivers below so the note/rhythm logic exists exactly once.
  const emitPhrase = (start: number, end: number, bpm: number, phraseIndex: number): void => {
    minBpmSeen = Math.min(minBpmSeen, bpm);
    maxBpmSeen = Math.max(maxBpmSeen, bpm);

    const beatDurationSec = 60 / bpm;
    const phraseDurationSec = PHRASE_BEATS * beatDurationSec;

    const avgCadence = averageOf(cadences, start, end);
    const avgHr = averageOf(heartRates, start, end);
    const avgPower = averageOf(powers, start, end);

    const smoothedCadence = Math.max(
      30,
      Math.min(130, avgCadence * SENSITIVITY + 80 * (1 - SENSITIVITY))
    );

    const stepDurationSec = beatDurationSec / 4;
    const barDurationSec = beatDurationSec * BEATS_PER_BAR;
    const pulses = clamp(Math.round(3 + ((smoothedCadence - 30) / 100) * 9), 3, 12);
    const powerNorm = clamp(avgPower / maxPower, 0, 1);
    const rotation = Math.round(powerNorm * 3);
    const pattern = euclideanPattern(pulses, STEPS_PER_BAR, rotation);
    const phraseEndTimeSec = currentTimeSec + phraseDurationSec;
    const barsInPhrase = Math.ceil(phraseDurationSec / barDurationSec);
    const pointSpan = Math.max(1, end - start);
    const firstOnsetInHalf = [pattern.findIndex((onset, step) => onset && step < 8), -1];
    firstOnsetInHalf[1] = pattern.findIndex((onset, step) => onset && step >= 8);
    const onsets: Array<{ bar: number; step: number; time: number; subStart: number }> = [];

    for (let bar = 0; bar < barsInPhrase; bar++) {
      const barStartTime = currentTimeSec + bar * barDurationSec;
      for (let step = 0; step < STEPS_PER_BAR; step++) {
        const noteTime = barStartTime + step * stepDurationSec;
        if (noteTime >= phraseEndTimeSec - 1e-9) break;
        if (!pattern[step]) continue;
        const pos = (bar * STEPS_PER_BAR + step) / (barsInPhrase * STEPS_PER_BAR);
        const subStart = start + Math.floor(pos * pointSpan);
        onsets.push({ bar, step, time: noteTime, subStart });
      }
    }

    let previousPitch: number | null = null;
    let repeatCycleIndex = 0;
    const neighborCycle = [0, -1, 0, 1];

    for (let i = 0; i < onsets.length; i++) {
      const onset = onsets[i];
      const subStart = clamp(onset.subStart, start, end - 1);
      const subEnd = i < onsets.length - 1 ? clamp(onsets[i + 1].subStart, subStart + 1, end) : end;
      const avgSubAlt = averageOf(altitudes, subStart, subEnd);
      const avgSubHr = averageOf(heartRates, subStart, subEnd);
      const avgSubPower = averageOf(powers, subStart, subEnd);

      const basePitch = elevationToPitch(avgSubAlt, minAlt, maxAlt, scaleNotes);
      const baseIndex = Math.max(0, scaleNotes.indexOf(basePitch));
      const gradStartIndex = clamp(subStart, start, end - 1);
      const gradEndIndex = clamp(subEnd, start, end - 1);
      const grad = altitudes[gradEndIndex] - altitudes[gradStartIndex];
      const degreeOffset = clamp(Math.round(grad / 2), -3, 3);
      let pitchIndex = clamp(baseIndex + degreeOffset, 0, scaleNotes.length - 1);
      let pitch = scaleNotes[pitchIndex];

      if (previousPitch !== null && pitch === previousPitch) {
        pitchIndex = clamp(
          pitchIndex + neighborCycle[repeatCycleIndex % neighborCycle.length],
          0,
          scaleNotes.length - 1
        );
        pitch = scaleNotes[pitchIndex];
        repeatCycleIndex++;
      } else {
        repeatCycleIndex = 0;
      }
      if (previousPitch !== null && Math.abs(pitch - previousPitch) > 2) {
        const previousIndex = Math.max(0, scaleNotes.indexOf(previousPitch));
        pitchIndex = clamp(previousIndex + Math.sign(pitchIndex - previousIndex), 0, scaleNotes.length - 1);
        pitch = scaleNotes[pitchIndex];
      }

      let accent = -0.04;
      if (onset.step === 0) {
        accent = 0.12;
      } else if (onset.step === firstOnsetInHalf[0] || onset.step === firstOnsetInHalf[1]) {
        accent = 0.06;
      }
      const velocity = clamp(heartRateToVelocity(avgSubHr, minHr, maxHr) + accent, 0.05, 1);
      const powerRatio = avgPower > 0 ? avgSubPower / avgPower : 1;
      const articulation = powerRatio > 1.25 ? 0.45 : powerRatio < 0.75 ? 0.95 : 0.8;

      melodicTrack.addNote({
        midi: pitch,
        time: onset.time,
        duration: Math.min(stepDurationSec * articulation, phraseEndTimeSec - onset.time),
        velocity,
      });
      noteCount++;
      previousPitch = pitch;
    }

    addPercussionPhrase(
      percTrack,
      currentTimeSec,
      phraseDurationSec,
      smoothedCadence,
      bpm,
      powerNorm,
      avgHr,
      minHr,
      maxHr,
      phraseIndex
    );

    currentTimeSec += phraseDurationSec;
  };

  if (config.targetBars !== null) {
    // Compressed: the whole ride squeezed into targetBars. Equal point
    // slices, so each phrase covers the same share of the ride; BPM comes
    // from the slice-average speed rather than one instantaneous reading.
    const numPhrases = Math.max(1, Math.round(config.targetBars / PHRASE_BARS));
    for (let phrase = 0; phrase < numPhrases; phrase++) {
      if (phrase % YIELD_EVERY === 0) {
        onProgress?.(phrase / numPhrases);
        await yieldToEventLoop();
      }
      const start = Math.floor((phrase * points.length) / numPhrases);
      const end =
        phrase === numPhrases - 1
          ? points.length
          : Math.max(start + 1, Math.floor(((phrase + 1) * points.length) / numPhrases));
      const bpm = speedToBpm(averageOf(speeds, start, end), config.tempoMin, config.tempoMax);
      emitPhrase(start, end, bpm, phrase);
    }
  } else {
    // Full ride 1:1: each phrase consumes as many points as fit in 4 bars
    // of real elapsed time at that phrase's BPM.
    let i = 0;
    let phraseCount = 0;
    while (i < points.length) {
      if (phraseCount % YIELD_EVERY === 0) {
        onProgress?.(i / points.length);
        await yieldToEventLoop();
      }
      const phraseIndex = phraseCount;
      phraseCount++;

      const bpm = speedToBpm(points[i].speed, config.tempoMin, config.tempoMax);
      const beatDurationSec = 60 / bpm;
      const phraseDurationSec = PHRASE_BEATS * beatDurationSec;

      const secondsPerPoint =
        i < points.length - 1
          ? Math.max(0.1, (points[i + 1].timestamp - points[i].timestamp) / 1000)
          : 1;

      const pointsInPhrase = Math.max(1, Math.round(phraseDurationSec / secondsPerPoint));
      const phraseEnd = Math.min(i + pointsInPhrase, points.length);

      emitPhrase(i, phraseEnd, bpm, phraseIndex);
      i = phraseEnd;
    }
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
  powerNorm: number,
  avgHr: number,
  minHr: number,
  maxHr: number,
  phraseIndex: number
): void {
  const beatDuration = 60 / bpm;
  const stepDuration = beatDuration / 4;
  const barDuration = beatDuration * BEATS_PER_BAR;
  const barsInPhrase = Math.ceil(phraseDuration / barDuration);
  const phraseEndTime = startTime + phraseDuration;
  const kickPulses = clamp(2 + Math.round(powerNorm * 3), 2, 5);
  const kickPattern = euclideanPattern(kickPulses, STEPS_PER_BAR, 0);
  const hrRange = maxHr - minHr;
  const hrNorm = hrRange > 0 ? clamp((avgHr - minHr) / hrRange, 0, 1) : 0;
  const baseHatNote = cadenceRpm > 80 ? PERC_HIHAT_CLOSED : PERC_HIHAT_OPEN;
  const fillPhrase = (phraseIndex + 1) % 4 === 0;
  const fillVelocities = [0.4, 0.5, 0.65, 0.8];

  for (let bar = 0; bar < barsInPhrase; bar++) {
    const barStartTime = startTime + bar * barDuration;
    const isFillBar = fillPhrase && bar === barsInPhrase - 1;

    for (let step = 0; step < STEPS_PER_BAR; step++) {
      const noteTime = barStartTime + step * stepDuration;
      if (noteTime >= phraseEndTime - 1e-9) break;

      if (kickPattern[step]) {
        track.addNote({
          midi: PERC_KICK,
          time: noteTime,
          duration: 0.1,
          velocity: 0.6 + powerNorm * 0.25,
        });
      }

      if (isFillBar && step >= 12) {
        track.addNote({
          midi: PERC_SNARE,
          time: noteTime,
          duration: 0.08,
          velocity: fillVelocities[step - 12],
        });
      } else if (step === 4 || step === 12) {
        track.addNote({
          midi: PERC_SNARE,
          time: noteTime,
          duration: 0.08,
          velocity: 0.55,
        });
      } else if (step === 15 && hrNorm > 0.6) {
        track.addNote({
          midi: PERC_SNARE,
          time: noteTime,
          duration: 0.06,
          velocity: 0.25,
        });
      }

      if (step % 2 === 0) {
        const isLastOffBeat = step === 14;
        const forceOpenAccent = hrNorm > 0.7 && isLastOffBeat;
        track.addNote({
          midi: forceOpenAccent ? PERC_HIHAT_OPEN : baseHatNote,
          time: noteTime,
          duration: 0.05,
          velocity: forceOpenAccent ? 0.55 : step % 4 === 0 ? 0.62 : 0.38,
        });
      }
    }
  }
}
