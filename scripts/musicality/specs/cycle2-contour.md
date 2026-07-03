# Cycle 2 — Musical content: melodic contour, per-note dynamics, living percussion

## Problem
After Cycles 1/1.5 the piece has groove and a listenable length, but Steven's
verdict is "still very boring and repetitive," and the metrics agree:
- Melody: ONE pitch per 4-bar phrase, repeated on every Euclidean onset
  (bars64 consecutiveRepeatRate 0.97, fourGramRepeatRate ~0.88).
- Velocity: one value per phrase (velocityStd 0.054–0.086).
- Percussion: identical kick-on-even/snare-on-odd grid with constant-interval
  hi-hats, every bar, forever.

## Scope
All changes live in `src/lib/midi/converter.ts` (emitPhrase +
addPercussionPhrase). Do NOT touch euclidean.ts, scales.ts, segmenter.ts,
parsers, harness, UI, or MidiConfig. Everything must be DETERMINISTIC — no
Math.random / Date.now; all variation is data-driven or index-driven.

## Changes

### 1. Intra-phrase melodic contour (kills the one-pitch drone)
For each Euclidean ONSET in a phrase (bar b, step s), instead of the single
phrase pitch:
- Compute the onset's position in the phrase: `pos = (b*16 + s) / (bars*16)`.
- Map it to a sub-slice of the phrase's point range [start, end):
  `subStart = start + floor(pos * (end - start))`, sub-slice extends to the
  next onset's subStart (or `end` for the last onset).
- `avgAlt` of that sub-slice -> `elevationToPitch(...)` = the onset's BASE
  pitch. The melody now traces the ride's elevation profile WITHIN the phrase.
- Gradient push: `grad = altAt(subEnd) - altAt(subStart)` (meters). Convert to
  scale-degree offset: `degreeOffset = clamp(round(grad / 2), -3, +3)`. Move
  the base pitch by that many positions WITHIN the scaleNotes array (index
  arithmetic on the quantized pitch's index, clamped to array bounds). Climbs
  push the line up beyond its absolute-elevation position; descents pull down.
- Flat-ride guard (cycling and went-fast are nearly flat): keep the previous
  onset's final pitch in a closure variable. When the computed pitch equals
  it, apply a neighbor-tone cycle: consecutive repeats walk the offset cycle
  [0, -1, 0, +1] (scaleNotes-index offsets, clamped) — the classic turn
  figure. Reset the cycle when the pitch moves on its own.

### 2. Per-note dynamics + articulation
- Velocity per onset = heartRateToVelocity(sub-slice avgHr) with accents:
  +0.12 on step 0 of each bar (downbeat), +0.06 on the FIRST onset of each
  Euclidean pattern half (steps 0-7 / 8-15), -0.04 on all other onsets.
  Clamp to [0.05, 1].
- Articulation from power: compute the phrase slice's avgPower once (already
  available). Per onset, sub-slice power vs phrase avgPower: ratio > 1.25 ->
  duration 0.45 * step (staccato stab); ratio < 0.75 -> 0.95 * step (legato);
  else 0.8 * step (current default). Keep the existing end-of-phrase clamp.

### 3. Percussion that lives (rewrite addPercussionPhrase internals; same
signature + same 4 GM notes 36/38/42/46, channel 10)
Work on the same 16-step-per-bar grid as the melody (pass beatDuration-derived
step timing; bars from phraseDuration as today):
- KICK: euclideanPattern(kickPulses, 16, 0) with
  `kickPulses = clamp(2 + round(powerNorm * 3), 2, 5)` (powerNorm = phrase
  avgPower / ride maxPower — pass it in or derive from existing args), always
  anchored so step 0 fires (the generator already starts patterns on an onset).
- SNARE: backbeat steps 4 and 12, velocity 0.55. Ghost note on step 15 at
  velocity 0.25 when hrNorm > 0.6 (hrNorm = (avgHr - minHr)/(maxHr - minHr);
  extend the signature or compute from existing avgHr/maxHr args — minHr may
  be approximated as maxHr - 60 if not available; prefer passing minHr).
- HI-HAT: every 2nd step (8ths), velocity alternating 0.62 (on-beat) / 0.38
  (off-beat), closed (42) when cadenceRpm > 80 else open (46) — keep that
  rule but ALSO: when hrNorm > 0.7, the LAST off-beat of each bar becomes
  open hat at 0.55 regardless of cadence.
- FILL: in the LAST bar of every 4th phrase (pass a phraseIndex arg), replace
  steps 12-15 with snare hits at velocities 0.4/0.5/0.65/0.8 (kick/hat
  unchanged there).
- Remove the `void avgHr; void maxHr;` — they're finally used.

## Acceptance (bars64 numbers; run `npm run musicality`)
Per fixture, melody:
- consecutiveRepeatRate <= 0.35 (from ~0.97)
- intervalStep >= 0.35 (stepwise motion becomes a real presence)
- fourGramRepeatRate <= 0.60
- velocityStd >= 0.09
- restRatio stays in [0.30, 0.70]
- GUARDRAILS: inScaleRate = 1.0; musicDurationMin within ±5% of baseline
  bars64; bpmRange identical; noteCount within ±10% of baseline bars64
  (contour must not add/remove onsets — same Euclidean grid).
Percussion (bars64):
- velocityStd >= 0.10 (from ~0.09 flat)
- ioiEntropyBits: increases vs baseline bars64
Full mode: melody gates NOT evaluated (it shares emitPhrase and will improve
too); only check inScaleRate = 1.0 and musicDurationMin/bpmRange unchanged
vs baseline full.
`npm run typecheck` and `npm run build` pass.
Do not commit; leave changes in the working tree; report per-fixture metrics.
