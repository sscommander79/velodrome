# Cycle 1 — Euclidean rhythm engine (rests + groove)

## Problem
The converter stamps N identical, evenly spaced notes per 4-bar phrase
(`src/lib/midi/converter.ts`, the `numNotesInPhrase` loop). Baseline metrics
(`scripts/musicality/baseline.json`): restRatio 0.15 (= pure 0.85 duty-cycle
artifact, zero real rests), machine-gun texture. The Digitakt segmenter
(`src/lib/midi/segmenter.ts`) emits 16 wall-to-wall full-length steps.

## Scope (this cycle ONLY)
Rhythm and rests. Do NOT change pitch selection, velocity mapping, BPM
mapping, percussion, or the UI. `MidiConfig` stays unchanged.

## Changes

### 1. New module `src/lib/midi/euclidean.ts`
```
export function euclideanPattern(pulses: number, steps: number, rotation = 0): boolean[]
```
Bjorklund/Euclidean distribution: `pulses` onsets spread maximally evenly
across `steps` slots, rotated left by `rotation`. Must satisfy the classic
identities, e.g. E(3,8) = [x..x..x.], E(5,8) = [x.xx.xx.], E(4,16) =
four-on-the-floor. Clamp pulses to [0, steps].

### 2. Converter melody loop
Replace the uniform stamping loop with, per 4-bar phrase:
- Grid: 16 steps per **bar** at 16th-note resolution (step = beatDurationSec/4),
  same pattern repeated for the 4 bars of the phrase (rhythmic repetition
  within a phrase is groove, not boredom).
- Pulses from cadence: `k = round(3 + ((smoothedCadence - 30) / 100) * 9)`,
  clamped to [3, 12].
- Rotation from power: normalize avgPower by the ride's max phrase power
  (compute max in the existing hoist pass or a pre-pass), then
  `rotation = round(powerNorm * 3)` (0–3).
- Onset steps get a note at the phrase's pitch/velocity (unchanged this
  cycle); non-onset steps are RESTS (no note).
- Note duration: `0.8 * stepDuration`.
- Handle a partial trailing bar (phraseDuration not an exact multiple of a
  bar) by truncating the last pattern repeat; never emit a note past the
  phrase end.

### 3. Segmenter (Digitakt path)
- `active`: apply `euclideanPattern(k, 16, rotation)` as a mask AND the
  existing cadence>20 check. `k` from ride-mean cadence via the same formula
  clamped to [6, 12] (a DT pattern with <6 trigs of 16 feels empty),
  rotation from ride-mean power normalized by ride max power (0–3).
- `length`: replace constant `0x7f` with cadence-mapped: slice cadence 30–130
  → length 0x20–0x7f (round, clamp).
- Keep note/velocity mapping unchanged.

## Acceptance (run `npm run musicality`, compare vs baseline.json)
Per fixture, melody track:
- restRatio: from 0.15 to within [0.30, 0.70]
- ioiEntropyBits: increases
- noteCount: decreases (rests replace filler)
- GUARDRAILS unchanged: inScaleRate = 1.0; conversion.musicDurationMin within
  ±1%; bpmRange identical; uniquePitches identical
- consecutiveRepeatRate/intervalStatic: NOT targets this cycle (pitch logic
  untouched) — must not get WORSE.
digitaktSteps:
- activeRatio in [0.35, 0.8]
- uniqueNotes: unchanged or ±1

`npm run typecheck` must pass. Do not commit; leave changes in the working
tree for review.
