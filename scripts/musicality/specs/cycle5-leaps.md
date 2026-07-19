# Cycle 5 — Melodic leaps & phrase shape

## Problem
After Cycles 1–4 the compressed reel (bars64) has groove, rests, contour,
dynamics, and harmony — but the melody still *wanders* rather than *sings*.
The metrics pinpoint why (`scripts/musicality/baseline.json`, bars64):
- `intervalLeap` 0.006–0.014 — the melody essentially **never jumps**. 99% of
  note-to-note moves are step (≤2 semitones) or static (0). No memorable
  gesture, no phrase climax.
- `intervalStatic` 0.24–0.38 — flat terrain collapses to a repeated pitch.

Root cause is explicit, not emergent: `src/lib/midi/converter.ts` **lines
173–177** contain a leap-suppression clamp added in Cycle 2 — any computed move
of >2 semitones from the previous pitch is forcibly collapsed to a single
scale step. A real leap IS being computed (`baseIndex + degreeOffset` from
gradient, line 158–159) and then crushed one line later. This cycle makes that
suppression **conditional** and sizes the surviving leaps by the ride's drama,
so Cycle 3's highlight windows finally get an audible melodic gesture.

## Scope (this cycle ONLY)
All changes live in `src/lib/midi/converter.ts`, inside `emitPhrase` (the
per-onset pitch loop, ~lines 141–197). Do NOT touch euclidean.ts, scales.ts,
highlights.ts, segmenter.ts, harmony/percussion functions, parsers, harness,
UI, or MidiConfig. Everything DETERMINISTIC — no Math.random / Date.now; all
variation is data-driven (gradient, dynamics) or index-driven (onset position).
Leaps are computed in scaleNotes-INDEX space and clamped to `[0,
scaleNotes.length-1]`, so `inScaleRate` stays 1.0 automatically. Onset COUNT
and timing are unchanged — this cycle changes only pitch selection, never which
steps fire.

## Changes

### 1. Per-onset leap magnitude from gradient drama
The current `degreeOffset = clamp(Math.round(grad / 2), -3, 3)` (line 158)
already turns gradient into a scale-degree push but caps it at ±3 and is then
neutralized by the >2-semitone clamp. Replace the fixed cap with a
drama-scaled leap:
- Keep `basePitch`/`baseIndex` (elevation) and `grad` (sub-slice gradient in
  meters) as they are.
- Compute a phrase-relative gradient magnitude. Before the onset loop, gather
  `absGrads` = |grad| for every onset in the phrase; let `gradPeak =
  max(absGrads, small-epsilon)`. Per onset, `dramaNorm = |grad| / gradPeak` in
  [0,1].
- `leapDegrees = sign(grad) * round(dramaNorm * MAX_LEAP)` where `MAX_LEAP = 7`
  (≈ one octave in scale-index space; a 4th/5th ≈ 3–4). Tune MAX_LEAP only if
  needed to land the gate.
- `pitchIndex = clamp(baseIndex + leapDegrees, 0, scaleNotes.length - 1)`.
  The steepest onset(s) of each phrase now leap; gentle onsets stay near the
  elevation base.

### 2. Make the leap-suppression clamp conditional (lines 173–177)
- Designate an onset as a **leap onset** when `dramaNorm >= LEAP_GATE` (start
  `LEAP_GATE = 0.6`) OR it is the phrase's single steepest onset (the argmax of
  `absGrads`, always a leap onset so every phrase gets one gesture even on
  gentle terrain).
- On a leap onset: SKIP the >2-semitone collapse — allow the full jump.
- On a non-leap onset: keep the existing clamp (smooth wandering to ≤1 step)
  AND keep the existing neighbor-cycle repeat handling (lines 162–172)
  unchanged. Leap onsets bypass the neighbor cycle (they are not repeats).

### 3. Phrase arc (gives shape; covers near-flat fixtures)
Flat rides have `grad≈0`, so terrain leaps won't fire and the melody would
stay static. Add a deterministic contour envelope so every phrase breathes and
its steepest-onset leap has somewhere to resolve:
- `arcPos = onsetIndex / max(1, onsets.length - 1)` in [0,1].
- `arc = round(ARC_DEPTH * sin(pi * arcPos))` scale-index positions
  (`ARC_DEPTH = 2`): a gentle rise to a mid-phrase peak and fall back.
- Apply the arc to non-leap onsets only (leap onsets already have their gesture
  from §1/§2): `pitchIndex = clamp(pitchIndex + arc, 0, scaleNotes.length-1)`
  BEFORE the §2 smoothing clamp, so the arc reads as intentional shape, not a
  suppressed jump. On near-flat fixtures the arc peak + the guaranteed
  steepest-onset leap together produce real vertical motion.

Dynamics, articulation, velocity, harmony, and percussion are UNCHANGED.

## Acceptance (bars64 numbers; run `npm run musicality`)
Per fixture, melody:
- **`intervalLeap` in [0.06, 0.30]** (from 0.006–0.014) — the headline gate.
  Leaps must be a real, audible presence but still spice, not the norm.
- `intervalStep` >= 0.30 (steps remain the dominant motion).
- `intervalStatic` <= 0.35 (down or flat vs baseline; no fixture worse).
- `fourGramRepeatRate` <= 0.50 (not worse than baseline bars64 ~0.41–0.47;
  ideally lower — shaped phrases repeat less).
- `consecutiveRepeatRate` <= 0.35 (preserve the Cycle 2 gain).
- `velocityStd` >= 0.09 (dynamics preserved — this cycle must not regress them).
- GUARDRAILS: `inScaleRate` = 1.0 exactly; `noteCount` within ±2% of baseline
  bars64 (pitch-only change — onset count must be essentially identical);
  `musicDurationMin` within ±5% of baseline bars64; `bpmRange` identical to
  baseline bars64.

Full mode: melody gates NOT evaluated (shares `emitPhrase`, improves too).
Check only `inScaleRate` = 1.0, and `musicDurationMin`/`bpmRange` unchanged vs
baseline full.

`npm run typecheck` and `npm run build` pass.

## Build contract
Do NOT commit. Leave changes in the working tree and report the full
per-fixture bars64 metric table (both fixtures × all melody metrics above)
plus the full-mode guardrail checks, so the spec author can verify against the
gates and run the listening UAT before re-baselining. If a gate cannot be met
without violating a guardrail, STOP and report the conflict rather than
loosening a guardrail.

## Explicit non-goals (future cycles, do not do here)
- No per-window interestingness score threading from highlights.ts into leaps
  (Cycle 6 multi-signal territory). Leaps here are gradient- + index-driven.
- No new data-signal mapping (speed/HR/cadence density) — that is Cycle 6.
- No motif development / thematic recall — that is Cycle 7.
