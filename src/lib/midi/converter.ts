import { Midi } from '@tonejs/midi';
import { NormalizedRide, MidiConfig, ConversionResult } from '../types';
import {
  buildScaleNotes,
  elevationToPitch,
  speedToBpm,
  heartRateToVelocity,
} from './scales';
import { euclideanPattern } from './euclidean';
import { selectHighlights } from './highlights';

const PHRASE_BARS = 4;
const BEATS_PER_BAR = 4;
const PHRASE_BEATS = PHRASE_BARS * BEATS_PER_BAR;

const PERC_HIHAT_CLOSED = 42;
const PERC_HIHAT_OPEN = 46;
const PERC_KICK = 36;
const PERC_SNARE = 38;

const YIELD_EVERY = 50;

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
  const S = config.stepsPerBar ?? 16;

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

  const harmonyTrack = midi.addTrack();
  harmonyTrack.name = 'Harmony (Gradient)';
  harmonyTrack.channel = 1;

  const percTrack = midi.addTrack();
  percTrack.name = 'Rhythm (Cadence)';
  percTrack.channel = 9;

  let currentTimeSec = 0;
  let noteCount = 0;
  let minBpmSeen = config.tempoMax;
  let maxBpmSeen = config.tempoMin;

  const SENSITIVITY = Math.max(0.1, Math.min(1, config.rhythmicSensitivity));

  // ── Ride-level structure → song-level structure ─────────────────────────────
  // The old output mapped only *instantaneous* values to *local* events, which
  // gave texture but no narrative — every phrase had the same density, register
  // and energy. We now pre-scan the ride into per-phrase "intensity" (a blend of
  // effort and terrain drama) so the piece can build and release like a track.
  //
  // intensityOf(start,end) ∈ [0,1] combines HR effort, power, speed and the
  // absolute elevation change across the window. It is normalized against the
  // ride's own peak so a flat spin and an alpine climb both use the full range.
  const rideHrRange = Math.max(1, maxHr - minHr);
  const intensityRaw = (start: number, end: number): number => {
    const hrN = clamp((averageOf(heartRates, start, end) - minHr) / rideHrRange, 0, 1);
    const pwrN = clamp(averageOf(powers, start, end) / maxPower, 0, 1);
    const spdN = clamp(averageOf(speeds, start, end) / 15, 0, 1); // ~54km/h ceiling
    const climbN = clamp(Math.abs(altitudes[clamp(end - 1, 0, altitudes.length - 1)] - altitudes[start]) / 25, 0, 1);
    return clamp(0.4 * hrN + 0.25 * pwrN + 0.15 * spdN + 0.2 * climbN, 0, 1);
  };

  // Song-position envelope: even a monotone-effort ride should have an arc, so
  // we shape a gentle intro→build→peak→outro curve over the whole piece and
  // multiply it into the data-driven intensity. progress ∈ [0,1].
  const arcEnvelope = (progress: number): number => {
    // Intro → build → late peak → outro. Peaks at PEAK_AT (~72% through) so a
    // ride whose climax is late (e.g. a summit near the end) actually lands at
    // full energy there, then eases off for the outro. A gentle intro floor
    // avoids starting at full tilt. (The previous sin(pi*p/0.7) form peaked at
    // 35% and then *declined* through the back half — the opposite of intent.)
    const PEAK_AT = 0.72;
    const INTRO_FLOOR = 0.35;
    let e: number;
    if (progress <= PEAK_AT) {
      // Ease in from INTRO_FLOOR up to 1 at the peak (half-cosine rise).
      const t = progress / PEAK_AT;
      e = INTRO_FLOOR + (1 - INTRO_FLOOR) * (0.5 - 0.5 * Math.cos(Math.PI * t));
    } else {
      // Ease down from 1 to ~0.45 across the outro (half-cosine fall).
      const t = (progress - PEAK_AT) / (1 - PEAK_AT);
      e = 1 - 0.55 * (0.5 - 0.5 * Math.cos(Math.PI * t));
    }
    return clamp(e, 0.15, 1);
  };

  // Emit one 4-bar phrase for the point slice [start, end) at the given BPM.
  // Shared by both drivers below so the note/rhythm logic exists exactly once.
  const emitPhrase = (
    start: number,
    end: number,
    bpm: number,
    phraseIndex: number,
    progress: number,
  ): void => {
    minBpmSeen = Math.min(minBpmSeen, bpm);
    maxBpmSeen = Math.max(maxBpmSeen, bpm);

    const beatDurationSec = 60 / bpm;
    const phraseDurationSec = PHRASE_BEATS * beatDurationSec;

    const avgCadence = averageOf(cadences, start, end);
    const avgHr = averageOf(heartRates, start, end);
    const avgPower = averageOf(powers, start, end);

    // Combined phrase intensity: ride data × global arc. Drives density,
    // melodic register width, and drop-outs below.
    const dataIntensity = intensityRaw(start, end);
    const arc = arcEnvelope(progress);
    const intensity = clamp(dataIntensity * 0.7 + arc * 0.3, 0, 1);

    // Periodic "breakdown": every 8th phrase (but never the first) drops the
    // melodic density hard and mutes percussion for contrast. Silence is the
    // cheapest drama and the old output had none.
    const isBreakdown = phraseIndex > 0 && (phraseIndex + 1) % 8 === 0;

    const smoothedCadence = Math.max(
      30,
      Math.min(130, avgCadence * SENSITIVITY + 80 * (1 - SENSITIVITY))
    );

    const barDurationSec = beatDurationSec * BEATS_PER_BAR;
    const stepDurationSec = barDurationSec / S;
    const pulses = clamp(
      Math.round(3 + ((smoothedCadence - 30) / 100) * 9),
      3,
      Math.min(12, S)
    );
    const powerNorm = clamp(avgPower / maxPower, 0, 1);
    const rotation = Math.round(powerNorm * 3);
    const pattern = euclideanPattern(pulses, S, rotation);
    const phraseEndTimeSec = currentTimeSec + phraseDurationSec;
    const barsInPhrase = Math.ceil(phraseDurationSec / barDurationSec);
    const pointSpan = Math.max(1, end - start);
    const halfStep = Math.round(S / 2);
    const firstOnsetInHalf = [pattern.findIndex((onset, step) => onset && step < halfStep), -1];
    firstOnsetInHalf[1] = pattern.findIndex((onset, step) => onset && step >= halfStep);
    const onsets: Array<{ bar: number; step: number; time: number; subStart: number }> = [];

    // Density envelope: at low intensity keep only the strongest onsets
    // (downbeats and half-bar accents), filling in the finer subdivisions as
    // intensity rises. During a breakdown, keep only downbeats. This makes
    // sparse quiet passages and dense climaxes instead of a constant wall.
    const densityFloor = isBreakdown ? 0.0 : clamp(0.25 + intensity * 0.75, 0.25, 1);
    const keepOnset = (step: number, ordinal: number): boolean => {
      if (step === 0) return true;                       // always keep downbeat
      if (isBreakdown) return step === halfStep;          // breakdown: 2 hits max
      if (step === firstOnsetInHalf[0] || step === firstOnsetInHalf[1]) return true;
      // Deterministically thin the remaining onsets toward the density floor.
      const phase = (ordinal * 0.6180339887) % 1; // golden-ratio dither, stable
      return phase < densityFloor;
    };

    let onsetOrdinal = 0;
    for (let bar = 0; bar < barsInPhrase; bar++) {
      const barStartTime = currentTimeSec + bar * barDurationSec;
      for (let step = 0; step < S; step++) {
        const noteTime = barStartTime + step * stepDurationSec;
        if (noteTime >= phraseEndTimeSec - 1e-9) break;
        if (!pattern[step]) continue;
        if (!keepOnset(step, onsetOrdinal++)) continue;
        const pos = (bar * S + step) / (barsInPhrase * S);
        const subStart = start + Math.floor(pos * pointSpan);
        onsets.push({ bar, step, time: noteTime, subStart });
      }
    }

    let previousPitch: number | null = null;
    let previousEmittedTime = currentTimeSec - 1e-4;
    let melodicPitchSum = 0;
    let melodicPitchN = 0;
    let repeatCycleIndex = 0;
    const neighborCycle = [0, -1, 0, 1];
    const MAX_LEAP = 7;
    const LEAP_GATE = 0.6;
    const ARC_DEPTH = 2;
    const absGrads = onsets.map((onset, onsetIndex) => {
      const subStart = clamp(onset.subStart, start, end - 1);
      const subEnd =
        onsetIndex < onsets.length - 1
          ? clamp(onsets[onsetIndex + 1].subStart, subStart + 1, end)
          : end;
      const gradStartIndex = clamp(subStart, start, end - 1);
      const gradEndIndex = clamp(subEnd, start, end - 1);
      return Math.abs(altitudes[gradEndIndex] - altitudes[gradStartIndex]);
    });
    let steepestOnsetIndex = 0;
    for (let i = 1; i < absGrads.length; i++) {
      if (absGrads[i] > absGrads[steepestOnsetIndex]) steepestOnsetIndex = i;
    }
    const gradPeak = Math.max(absGrads[steepestOnsetIndex] ?? 0, Number.EPSILON);

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
      const dramaNorm = absGrads[i] / gradPeak;
      const leapDegrees = Math.sign(grad) * Math.round(dramaNorm * MAX_LEAP);
      const isLeapOnset = dramaNorm >= LEAP_GATE || i === steepestOnsetIndex;
      let pitchIndex = clamp(baseIndex + leapDegrees, 0, scaleNotes.length - 1);
      if (!isLeapOnset) {
        const arcPos = i / Math.max(1, onsets.length - 1);
        const arc = Math.round(ARC_DEPTH * Math.sin(Math.PI * arcPos));
        pitchIndex = clamp(pitchIndex + arc, 0, scaleNotes.length - 1);
      }
      // Register width envelope (applied BEFORE the repeat-breaker so it can't
      // re-introduce consecutive repeats): compress toward the scale centre when
      // intensity is low, open to the full range at the peak. Leap onsets exempt.
      if (!isLeapOnset) {
        const center = (scaleNotes.length - 1) / 2;
        const widthFactor = clamp(0.7 + intensity * 0.3, 0.7, 1);
        pitchIndex = clamp(Math.round(center + (pitchIndex - center) * widthFactor), 0, scaleNotes.length - 1);
      }
      let pitch = scaleNotes[pitchIndex];

      if (!isLeapOnset && previousPitch !== null && pitch === previousPitch) {
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
      if (!isLeapOnset && previousPitch !== null && Math.abs(pitch - previousPitch) > 2) {
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
      // Dynamics follow the arc: scale HR-velocity by phrase intensity so the
      // whole track crescendos toward the peak and eases off in the outro,
      // instead of sitting at one flat level.
      const dynScale = 0.55 + intensity * 0.45;
      const velocity = clamp(heartRateToVelocity(avgSubHr, minHr, maxHr) * dynScale + accent, 0.05, 1);
      const powerRatio = avgPower > 0 ? avgSubPower / avgPower : 1;
      const articulation = clamp(1.25 - dramaNorm * 2 + (powerRatio - 1) * 0.15, 0.05, 0.98);
      const MAX_OFFSET = 0.12 * stepDurationSec;
      const seed = Math.sin((i + 1) * 12.9898 + onset.step * 78.233) * 43758.5453;
      const humanize = ((seed - Math.floor(seed)) - 0.5) * 2 * MAX_OFFSET;
      const humanizedTime = Math.max(onset.time + humanize, previousEmittedTime + 1e-4, currentTimeSec);

      melodicTrack.addNote({
        midi: pitch,
        time: humanizedTime,
        // Floor the note at 20ms so the shortest staccato at fast tempos is a
        // real audible attack, not a sub-perceptual click, while never
        // overrunning the phrase end.
        duration: Math.min(
          Math.max(stepDurationSec * articulation, 0.02),
          Math.max(0.001, phraseEndTimeSec - humanizedTime),
        ),
        velocity,
      });
      noteCount++;
      previousPitch = pitch;
      previousEmittedTime = humanizedTime;
      melodicPitchSum += pitch;
      melodicPitchN++;
    }

    // Average register of this phrase's melody, so harmony can voice away from
    // it (counterpoint) rather than colliding in the same octave.
    const melodicRegisterCenter = melodicPitchN > 0 ? melodicPitchSum / melodicPitchN : 60;

    addHarmonyPhrase(
      harmonyTrack,
      currentTimeSec,
      phraseDurationSec,
      beatDurationSec,
      start,
      end,
      altitudes,
      speeds,
      avgHr,
      minHr,
      maxHr,
      minAlt,
      maxAlt,
      scaleNotes,
      intensity,
      isBreakdown,
      phraseIndex,
      melodicRegisterCenter
    );

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
      S,
      phraseIndex,
      intensity,
      isBreakdown,
      avgPower,
      maxPower
    );

    currentTimeSec += phraseDurationSec;
  };

  if (config.targetBars !== null) {
    // Compressed: the whole ride squeezed into targetBars. Interesting
    // windows anchor the phrase sequence; BPM still comes from each
    // window's average speed rather than one instantaneous reading.
    const numPhrases = Math.max(1, Math.round(config.targetBars / PHRASE_BARS));
    const windows = selectHighlights(points, numPhrases);
    for (let phrase = 0; phrase < numPhrases; phrase++) {
      if (phrase % YIELD_EVERY === 0) {
        onProgress?.(phrase / numPhrases);
        await yieldToEventLoop();
      }
      const { start, end } = windows[phrase];
      const bpm = speedToBpm(averageOf(speeds, start, end), config.tempoMin, config.tempoMax);
      const progress = numPhrases > 1 ? phrase / (numPhrases - 1) : 0;
      emitPhrase(start, end, bpm, phrase, progress);
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

      const progress = points.length > 1 ? i / (points.length - 1) : 0;
      emitPhrase(i, phraseEnd, bpm, phraseIndex, progress);
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
  stepsPerBar: number,
  phraseIndex: number,
  intensity: number,
  isBreakdown: boolean,
  avgPower: number,
  maxPowerVal: number
): void {
  // Breakdown: mute the kit entirely (or leave a single downbeat kick) so the
  // drop-out actually drops out. This is the main source of contrast.
  if (isBreakdown) {
    track.addNote({ midi: PERC_KICK, time: startTime, duration: 0.1, velocity: 0.5 });
    return;
  }

  const beatDuration = 60 / bpm;
  const barDuration = beatDuration * BEATS_PER_BAR;
  const stepDuration = barDuration / stepsPerBar;
  const barsInPhrase = Math.ceil(phraseDuration / barDuration);
  const phraseEndTime = startTime + phraseDuration;
  const kickPulses = clamp(2 + Math.round(powerNorm * 3), 2, Math.min(5, stepsPerBar));
  const kickPattern = euclideanPattern(kickPulses, stepsPerBar, 0);
  const hrRange = maxHr - minHr;
  const hrNorm = hrRange > 0 ? clamp((avgHr - minHr) / hrRange, 0, 1) : 0;

  // ── Feel from cadence ────────────────────────────────────────────────────────
  // Low cadence → half-time (snare on beat 3 only, sparse hats); high cadence →
  // driving double-time (16th hats, backbeat on 2 & 4). This changes the groove
  // itself, not just which hi-hat sample plays.
  const feel: 'half' | 'normal' | 'double' =
    cadenceRpm < 70 ? 'half' : cadenceRpm > 100 ? 'double' : 'normal';
  const baseHatNote = cadenceRpm > 80 ? PERC_HIHAT_CLOSED : PERC_HIHAT_OPEN;
  const fillPhrase = (phraseIndex + 1) % 4 === 0;
  const fillVelocities = [0.4, 0.5, 0.65, 0.8];
  const quarterStep = Math.round(stepsPerBar / 4);
  const threeQuarterStep = Math.round((3 * stepsPerBar) / 4);
  const ghostStep = Math.floor(stepsPerBar - 1);
  // Hat resolution follows feel + intensity: sparser when calm, 16ths when hot.
  const hatDivisor = feel === 'double' ? 16 : feel === 'half' ? 4 : intensity > 0.6 ? 12 : 8;
  const hatEvery = Math.max(1, Math.round(stepsPerBar / hatDivisor));
  const lastHatStep = Math.floor(stepsPerBar - hatEvery);

  // ── Power-spike accents ──────────────────────────────────────────────────────
  // A hard effort within this phrase (relative to the ride's own max) throws an
  // open-hat/crash accent on the downbeat — a physical surge becomes an audible
  // one.
  const powerSpike = maxPowerVal > 0 && avgPower / maxPowerVal > 0.75;

  for (let bar = 0; bar < barsInPhrase; bar++) {
    const barStartTime = startTime + bar * barDuration;
    const isFillBar = fillPhrase && bar === barsInPhrase - 1;

    if (powerSpike) {
      // Crash-style open hat on each bar's downbeat during a surge.
      track.addNote({ midi: PERC_HIHAT_OPEN, time: barStartTime, duration: 0.18, velocity: 0.7 });
    }

    for (let step = 0; step < stepsPerBar; step++) {
      const noteTime = barStartTime + step * stepDuration;
      if (noteTime >= phraseEndTime - 1e-9) break;

      // Half-time drops every other kick for a slower, heavier feel.
      const kickHere = feel === 'half' ? kickPattern[step] && step % (quarterStep * 2) === 0 : kickPattern[step];
      if (kickHere) {
        track.addNote({
          midi: PERC_KICK,
          time: noteTime,
          duration: 0.1,
          velocity: 0.6 + powerNorm * 0.25,
        });
      }

      // Half-time backbeat lands on beat 3 only; others keep the 2 & 4 grid.
      if (feel === 'half') {
        if (step === threeQuarterStep) {
          track.addNote({ midi: PERC_SNARE, time: noteTime, duration: 0.08, velocity: 0.55 });
        }
      } else if (isFillBar && step >= threeQuarterStep) {
        const fillVelocityIndex = clamp(
          Math.floor(((step - threeQuarterStep) / quarterStep) * fillVelocities.length),
          0,
          fillVelocities.length - 1
        );
        track.addNote({
          midi: PERC_SNARE,
          time: noteTime,
          duration: 0.08,
          velocity: fillVelocities[fillVelocityIndex],
        });
      } else if (step === quarterStep || step === threeQuarterStep) {
        track.addNote({
          midi: PERC_SNARE,
          time: noteTime,
          duration: 0.08,
          velocity: 0.55,
        });
      } else if (step === ghostStep && hrNorm > 0.6) {
        track.addNote({
          midi: PERC_SNARE,
          time: noteTime,
          duration: 0.06,
          velocity: 0.25,
        });
      }

      if (step % hatEvery === 0) {
        const isLastOffBeat = step === lastHatStep;
        const forceOpenAccent = hrNorm > 0.7 && isLastOffBeat;
        track.addNote({
          midi: forceOpenAccent ? PERC_HIHAT_OPEN : baseHatNote,
          time: noteTime,
          duration: 0.05,
          velocity: forceOpenAccent ? 0.55 : step % quarterStep === 0 ? 0.62 : 0.38,
        });
      }
    }
  }
}

// Diatonic scale-degree progression (root offsets, in scale steps) cycled by
// phrase so the harmony actually *moves* instead of recolouring one static
// chord. Chosen to work in both major and minor: i/vi/III/VII-ish motion.
const HARMONY_PROGRESSION = [0, 5, 3, 4];

function addHarmonyPhrase(
  track: ReturnType<Midi['addTrack']>,
  startTime: number,
  phraseDuration: number,
  beatDuration: number,
  start: number,
  end: number,
  altitudes: number[],
  speeds: number[],
  avgHr: number,
  minHr: number,
  maxHr: number,
  minAlt: number,
  maxAlt: number,
  scaleNotes: number[],
  intensity: number,
  isBreakdown: boolean,
  phraseIndex: number,
  melodicRegisterCenter: number
): void {
  if (scaleNotes.length === 0 || end <= start) return;

  const degreesPerOctave = new Set(scaleNotes.map((note) => ((note % 12) + 12) % 12)).size;
  const avgAlt = averageOf(altitudes, start, end);
  const basePitch = elevationToPitch(avgAlt, minAlt, maxAlt, scaleNotes);
  const baseIndex = Math.max(0, scaleNotes.indexOf(basePitch));
  const gradient = altitudes[Math.max(start, end - 1)] - altitudes[start];

  // Harmonic movement: shift the chord root by the phrase's step in the
  // progression, on top of the elevation-derived base. Gives a sense of chord
  // changes across a section rather than one drone recoloured by gradient.
  const progressionStep = HARMONY_PROGRESSION[phraseIndex % HARMONY_PROGRESSION.length];
  const maxChordOffset = gradient > 3 ? 6 : 4;
  let rootIndex = clamp(
    baseIndex - degreesPerOctave + progressionStep,
    0,
    Math.max(0, scaleNotes.length - 1 - maxChordOffset)
  );

  const chordIndices =
    gradient > 3
      ? [rootIndex, rootIndex + 2, rootIndex + 4, rootIndex + 6] // climbing: lush 7th
      : gradient < -3
        ? [rootIndex, rootIndex + 2, rootIndex + 4]              // descending: open triad
        : [rootIndex, rootIndex + 3, rootIndex + 4];             // rolling: sus-ish colour
  let chordNotes = chordIndices.map((index) => scaleNotes[clamp(index, 0, scaleNotes.length - 1)]);

  // ── Voice away from the melody (counterpoint) ────────────────────────────────
  // If the chord sits in the same octave as the melody's current register they
  // fight; drop the whole voicing an octave when the melody is high, raise it
  // when the melody is low. Keeps harmony and melody in separate registers.
  // Shift the whole voicing by an octave — but ONLY if the shifted chord still
  // fits in range. A blind shift + per-note clamp could otherwise squash a
  // low chord's notes together into a unison drone (they'd all hit the 24
  // floor). We move the block only when it stays within [24,96] intact.
  const chordCenter = chordNotes.reduce((a, b) => a + b, 0) / chordNotes.length;
  const lo = Math.min(...chordNotes);
  const hi = Math.max(...chordNotes);
  if (chordCenter > melodicRegisterCenter - 3 && lo - 12 >= 24) {
    chordNotes = chordNotes.map((n) => n - 12);
  } else if (chordCenter < melodicRegisterCenter - 18 && hi + 12 <= 96) {
    chordNotes = chordNotes.map((n) => n + 12);
  }
  // Final safety clamp (chord already verified in-range above, so this is a
  // no-op in practice — kept as a guard against pathological scale configs).
  chordNotes = chordNotes.map((n) => clamp(n, 24, 96));

  const phraseEndTime = startTime + phraseDuration;
  const baseVelocity = clamp(
    heartRateToVelocity(avgHr, minHr, maxHr) * (0.55 + intensity * 0.4) - 0.12,
    0.05,
    0.9,
  );

  // ── Rhythm from terrain stability ────────────────────────────────────────────
  // Steady terrain (low gradient shift) → sustained pad chords; variable
  // terrain → syncopated stabs. Breakdown → a single held whole-note swell.
  const mid = start + Math.floor((end - start) / 2);
  const firstHalfGrad = altitudes[Math.max(start, mid - 1)] - altitudes[start];
  const secondHalfGrad = altitudes[Math.max(mid, end - 1)] - altitudes[mid];
  const gradShift = Math.abs(secondHalfGrad - firstHalfGrad);

  const emitChord = (t: number, dur: number, vel: number) => {
    for (const midiNote of chordNotes) {
      track.addNote({
        midi: midiNote,
        time: t,
        duration: Math.min(dur, phraseEndTime - t),
        velocity: vel,
      });
    }
  };

  if (isBreakdown) {
    // One long swell — the harmonic floor under the drop-out.
    emitChord(startTime, phraseDuration * 0.98, clamp(baseVelocity - 0.05, 0.05, 0.7));
    return;
  }

  const barDuration = beatDuration * BEATS_PER_BAR;
  const bars = Math.max(1, Math.round(phraseDuration / barDuration));

  if (gradShift < 4) {
    // Sustained pad: one chord per bar, gently accented on bar 1.
    for (let bar = 0; bar < bars; bar++) {
      const t = startTime + bar * barDuration;
      if (t >= phraseEndTime - 1e-9) break;
      emitChord(t, barDuration * 0.95, clamp(baseVelocity + (bar === 0 ? 0.06 : 0), 0.05, 0.9));
    }
  } else {
    // Syncopated stabs: hits on beats 1 and the "and" of 2/3, arpeggiated so
    // the voicing shimmers instead of blocking. Density rises with intensity.
    const eighth = beatDuration / 2;
    const totalEighths = Math.ceil(phraseDuration / eighth);
    const direction =
      secondHalfGrad > firstHalfGrad ? 'up' : secondHalfGrad < firstHalfGrad ? 'down' : 'pingpong';
    const stabPositions = new Set(
      intensity > 0.6 ? [0, 3, 4, 7, 8, 11] : [0, 3, 8, 11],
    );
    for (let step = 0; step < totalEighths; step++) {
      const inBar = step % (BEATS_PER_BAR * 2);
      if (!stabPositions.has(inBar)) continue;
      const noteTime = startTime + step * eighth;
      if (noteTime >= phraseEndTime - 1e-9) break;
      const chordPosition = harmonyChordPosition(step, chordNotes.length, direction);
      const vel = clamp(baseVelocity + (inBar === 0 ? 0.08 : 0), 0.05, 0.9);
      track.addNote({
        midi: chordNotes[chordPosition],
        time: noteTime,
        duration: Math.min(eighth * 1.6, phraseEndTime - noteTime),
        velocity: vel,
      });
    }
  }
}

function harmonyChordPosition(step: number, chordLength: number, direction: 'up' | 'down' | 'pingpong'): number {
  if (chordLength <= 1) return 0;
  if (direction === 'up') return step % chordLength;
  if (direction === 'down') return chordLength - 1 - (step % chordLength);

  const period = chordLength * 2 - 2;
  const position = step % period;
  return position < chordLength ? position : period - position;
}
