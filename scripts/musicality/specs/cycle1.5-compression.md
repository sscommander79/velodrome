# Cycle 1.5 — Time compression: "Length" control

## Problem
The MIDI-file path renders 1:1 — an 80-minute ride becomes an 80-minute MIDI
file. Ride telemetry drifts slowly, so adjacent 4-bar phrases are nearly
identical and the piece has no listenable arc. The Digitakt path already
compresses (whole ride -> 16 steps); the MIDI file needs the same idea:
squeeze the whole ride's story into a listenable number of bars.

## Scope (this cycle ONLY)
Time compression + its UI control. Do NOT change pitch selection, the
Euclidean rhythm engine, velocity, percussion patterns, or the segmenter.

## Changes

### 1. `MidiConfig` (src/lib/types.ts)
Add `targetBars: number | null` — `null` = full ride (current 1:1 behavior).

### 2. Converter (src/lib/midi/converter.ts)
When `targetBars` is a number:
- `numPhrases = max(1, round(targetBars / PHRASE_BARS))` (targetBars=64 -> 16
  phrases).
- Divide `points` into `numPhrases` equal contiguous index slices (last slice
  takes the remainder).
- Per phrase, compute BPM from the **slice-average speed** (not the first
  point's instantaneous speed), then proceed exactly as today: per-slice
  averages -> pitch/velocity/Euclidean pattern, phrase duration = 16 beats at
  that phrase's BPM.
When `targetBars` is `null`: behavior must be EXACTLY as today (full-mode
metrics must not move at all — this is a guardrail).

### 3. UI
- `src/pages/Home.tsx`: default config gains `targetBars: 64`.
- `src/components/ConfigurationPanel.tsx`: add a "Length" select following
  the existing key/mode select idiom, options: Full ride / 16 / 32 / 64 /
  128 bars. Default 64.

### 4. Harness (scripts/musicality/run.ts ONLY — do not touch metrics.ts,
gpx.ts, baseline.json)
- Score each fixture twice: full (`targetBars: null`) and `targetBars: 64`.
- Scoreboard per fixture: `{ full: <existing shape>, bars64: <same shape> }`.
- Emit `out/<name>.mid` (full) and `out/<name>-64bars.mid`.
- The baseline diff will be structurally noisy this once (shape change) —
  that is expected and fine.

## Acceptance
- `npm run typecheck` and `npm run build` pass.
- Full mode: every metric identical to `scripts/musicality/baseline.json`
  (zero regression — proves `null` path untouched).
- bars64, per fixture:
  - musicDurationMin in [1, 6] (64 bars at 60–160 BPM)
  - restRatio stays in [0.30, 0.70]
  - inScaleRate = 1.0
  - uniquePitches >= 6 (16 phrases traverse the ride's full elevation range)
  - adjacentWindowSimilarity <= its full-mode value for the same fixture
    (more change per unit time is the whole point)
- Do not commit; leave changes in the working tree and report the metrics.
