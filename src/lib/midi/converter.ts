import { Midi } from '@tonejs/midi';
import { NormalizedRide, MidiConfig, ConversionResult } from '../types';
import {
  buildScaleNotes,
  elevationToPitch,
  cadenceToNoteDuration,
  noteDurationToBeats,
  speedToBpm,
  heartRateToVelocity,
} from './scales';

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

  const minAlt = Math.min(...points.map((p) => p.altitude));
  const maxAlt = Math.max(...points.map((p) => p.altitude));
  const minHr = Math.min(...points.map((p) => p.heartRate));
  const maxHr = Math.max(...points.map((p) => p.heartRate));

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

    const avgCadence = averageOf(
      points.map((p) => p.cadence),
      i,
      phraseEnd
    );
    const avgAlt = averageOf(
      points.map((p) => p.altitude),
      i,
      phraseEnd
    );
    const avgHr = averageOf(
      points.map((p) => p.heartRate),
      i,
      phraseEnd
    );
    const avgPower = averageOf(
      points.map((p) => p.power),
      i,
      phraseEnd
    );

    const smoothedCadence = Math.max(
      30,
      Math.min(130, avgCadence * SENSITIVITY + 80 * (1 - SENSITIVITY))
    );

    const durationName = cadenceToNoteDuration(smoothedCadence);
    const durationBeats = noteDurationToBeats(durationName);
    const durationSec = durationBeats * beatDurationSec;

    const pitch = elevationToPitch(avgAlt, minAlt, maxAlt, scaleNotes);
    const velocity = heartRateToVelocity(avgHr, minHr, maxHr);

    const numNotesInPhrase = Math.max(1, Math.floor(phraseDurationSec / durationSec));

    for (let n = 0; n < numNotesInPhrase; n++) {
      const noteTime = currentTimeSec + n * durationSec;
      melodicTrack.addNote({
        midi: pitch,
        time: noteTime,
        duration: durationSec * 0.85,
        velocity,
      });
      noteCount++;
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
