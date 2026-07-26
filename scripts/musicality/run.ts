// Musicality harness: run fixture rides through the real conversion pipeline,
// score the MIDI output, and compare against the committed baseline.
//
//   npx tsx scripts/musicality/run.ts             # score + compare vs baseline
//   npx tsx scripts/musicality/run.ts --baseline  # overwrite baseline.json
//
// Emits out/<fixture>.mid for listening tests (out/ is gitignored).
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Midi } from '@tonejs/midi';
import { readGpx } from './gpx';
import { harmonyMetrics, melodicMetrics, percussionMetrics } from './metrics';
import { normalizeRide } from '../../src/lib/normalize';
import { convertToMidi } from '../../src/lib/midi/converter';
import { segmentRide } from '../../src/lib/midi/segmenter';
import { selectHighlights } from '../../src/lib/midi/highlights';
import { speedToBpm } from '../../src/lib/midi/scales';
import type { MidiConfig } from '../../src/lib/types';

const DIR = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(DIR, 'out');
const BASELINE_PATH = join(DIR, 'baseline.json');

const FIXTURES = ['cycling', 'shadow-mountain', 'went-fast'];

// Mirror the app's default configuration (src/pages/Home.tsx).
const CONFIG: MidiConfig = {
  key: 'C',
  mode: 'minor',
  tempoMin: 60,
  tempoMax: 160,
  rhythmicSensitivity: 0.5,
  targetBars: 64,
  stepsPerBar: 16,
};

function round(obj: Record<string, number>): Record<string, number> {
  return Object.fromEntries(
    Object.entries(obj).map(([k, v]) => [k, Math.round(v * 1000) / 1000])
  );
}

function chordPhraseCounts(
  ride: ReturnType<typeof normalizeRide>,
  config: MidiConfig
): Record<'climbPhrases' | 'descendPhrases' | 'flatPhrases', number> {
  const counts = { climbPhrases: 0, descendPhrases: 0, flatPhrases: 0 };
  const { points } = ride;
  const classify = (start: number, end: number): void => {
    const gradient = points[Math.max(start, end - 1)].altitude - points[start].altitude;
    if (gradient > 3) counts.climbPhrases++;
    else if (gradient < -3) counts.descendPhrases++;
    else counts.flatPhrases++;
  };

  if (config.targetBars !== null) {
    const numPhrases = Math.max(1, Math.round(config.targetBars / 4));
    for (const { start, end } of selectHighlights(points, numPhrases)) classify(start, end);
    return counts;
  }

  let i = 0;
  while (i < points.length) {
    const bpm = speedToBpm(points[i].speed, config.tempoMin, config.tempoMax);
    const phraseDurationSec = 16 * (60 / bpm);
    const secondsPerPoint =
      i < points.length - 1
        ? Math.max(0.1, (points[i + 1].timestamp - points[i].timestamp) / 1000)
        : 1;
    const phraseEnd = Math.min(i + Math.max(1, Math.round(phraseDurationSec / secondsPerPoint)), points.length);
    classify(i, phraseEnd);
    i = phraseEnd;
  }

  return counts;
}

async function scoreFixture(name: string, targetBars: number | null, midiName: string) {
  const parsed = readGpx(join(DIR, 'fixtures', `${name}.gpx`));
  const ride = normalizeRide(parsed);
  const config: MidiConfig = { ...CONFIG, targetBars };
  const result = await convertToMidi(ride, config);

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(join(OUT_DIR, midiName), result.midiBytes);

  const midi = new Midi(result.midiBytes);
  const span = result.durationSeconds;

  const steps = segmentRide(ride, 16, config);
  const stepNotes = steps.filter((s) => s.active).map((s) => s.note);

  return {
    ride: {
      points: ride.points.length,
      durationMin: Math.round(ride.durationSeconds / 60),
      elevationGain: Math.round(ride.elevationGain),
      availability: ride.availability,
    },
    conversion: {
      noteCount: result.noteCount,
      musicDurationMin: Math.round((span / 60) * 10) / 10,
      bpmRange: result.bpmRange,
    },
    melody: round(melodicMetrics(midi, config, span) as unknown as Record<string, number>),
    percussion: round(percussionMetrics(midi, span) as unknown as Record<string, number>),
    harmony: {
      ...round(harmonyMetrics(midi, config, span) as unknown as Record<string, number>),
      ...chordPhraseCounts(ride, config),
    },
    digitaktSteps: {
      activeRatio: Math.round((steps.filter((s) => s.active).length / steps.length) * 1000) / 1000,
      uniqueNotes: new Set(stepNotes).size,
      velocityStd: Math.round(
        Math.sqrt(
          stepNotes.length
            ? steps.filter((s) => s.active).reduce((acc, s, _, arr) => {
                const mean = arr.reduce((a, x) => a + x.velocity, 0) / arr.length;
                return acc + (s.velocity - mean) ** 2 / arr.length;
              }, 0)
            : 0
        ) * 10
      ) / 10,
    },
  };
}

function compare(baseline: any, current: any, path = ''): string[] {
  const lines: string[] = [];
  for (const key of Object.keys(current)) {
    const b = baseline?.[key];
    const c = current[key];
    if (typeof c === 'object' && c !== null && !Array.isArray(c)) {
      lines.push(...compare(b, c, `${path}${key}.`));
    } else if (typeof c === 'number' && typeof b === 'number' && Math.abs(c - b) > 1e-9) {
      const delta = c - b;
      lines.push(`  ${path}${key}: ${b} -> ${c} (${delta > 0 ? '+' : ''}${Math.round(delta * 1000) / 1000})`);
    }
  }
  return lines;
}

async function main() {
  const writeBaseline = process.argv.includes('--baseline');
  const scoreboard: Record<string, any> = {};

  for (const name of FIXTURES) {
    console.log(`Scoring ${name}...`);
    scoreboard[name] = {
      full: await scoreFixture(name, null, `${name}.mid`),
      bars64: await scoreFixture(name, 64, `${name}-64bars.mid`),
    };
  }

  writeFileSync(join(OUT_DIR, 'scoreboard.json'), JSON.stringify(scoreboard, null, 2));
  console.log(`\nScoreboard written to scripts/musicality/out/scoreboard.json`);

  if (writeBaseline) {
    writeFileSync(BASELINE_PATH, JSON.stringify(scoreboard, null, 2));
    console.log(`Baseline written to scripts/musicality/baseline.json`);
    return;
  }

  if (existsSync(BASELINE_PATH)) {
    const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
    console.log('\n=== Changes vs baseline ===');
    let any = false;
    for (const name of FIXTURES) {
      const diffs = compare(baseline[name], scoreboard[name]);
      if (diffs.length) {
        any = true;
        console.log(`\n${name}:`);
        console.log(diffs.join('\n'));
      }
    }
    if (!any) console.log('No changes.');
  } else {
    console.log('No baseline yet — run with --baseline to create one.');
  }

  console.log('\n=== Summary ===');
  for (const name of FIXTURES) {
    const full = scoreboard[name].full;
    const bars64 = scoreboard[name].bars64;
    const m = bars64.melody;
    const h = bars64.harmony;
    console.log(
      `${name}: fullNotes=${full.conversion.noteCount} bars64Notes=${bars64.conversion.noteCount} ` +
      `bars64Duration=${bars64.conversion.musicDurationMin} ` +
      `uniquePitches=${m.uniquePitches} repeatRate=${m.consecutiveRepeatRate} ` +
      `4gramRepeat=${m.fourGramRepeatRate} restRatio=${m.restRatio} ` +
      `adjacentWindowSimilarity=${m.adjacentWindowSimilarity} velStd=${m.velocityStd} ` +
      `inScale=${m.inScaleRate} harmonyNotes=${h.noteCount} harmonyInScale=${h.inScaleRate} ` +
      `harmonyVelStd=${h.velocityStd} climb=${h.climbPhrases} descend=${h.descendPhrases} flat=${h.flatPhrases}`
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
