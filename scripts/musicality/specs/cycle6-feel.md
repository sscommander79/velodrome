# Cycle 6 — Rhythmic feel: note length & microtiming

## Problem
After Cycle 5 the melody leaps and sings in PITCH, but its RHYTHM is still
robotic in two measurable ways (harness metrics added in `75ef171`, bars64):
- `gateLengthStd` 0.086–0.105 — note length comes from a 3-bucket articulation
  (`powerRatio > 1.25 ? 0.45 : < 0.75 ? 0.95 : 0.8`), so nearly every note is
  the same relative length. No mix of short stabs and sustained tones.
- `offGridDeviation` ~0.003–0.006 (= zero) — every onset lands exactly on the
  grid. Machine-perfect, not human.

Cycle 6 humanizes the note layer: continuous data-driven note length, and small
deterministic off-grid microtiming.

## Scope (this cycle ONLY)
All changes live in `src/lib/midi/converter.ts`, inside `emitPhrase`'s per-onset
loop (the `melodicTrack.addNote` block, ~lines 179–195). MELODY ONLY. Do NOT
touch percussion, harmony, euclidean.ts, scales.ts, highlights.ts, segmenter.ts,
the harness, UI, or MidiConfig. Everything DETERMINISTIC — no Math.random /
Date.now. Pitch is UNTOUCHED (Cycle 5 gains must be preserved exactly). Onset
COUNT is unchanged — this cycle changes note DURATION and small time OFFSETS
only, never which steps fire.

`dramaNorm` (= |grad| / gradPeak, per onset, in [0,1]) is already computed in the
loop by Cycle 5 — reuse it as the continuous feel driver.

## Changes

### 1. Continuous note length (kills the 3-value articulation)
Replace the bucketed `articulation` with a continuous function so calm passages
sustain and dramatic ones stab:
- `const articulation = clamp(0.95 - dramaNorm * 0.6 + (powerRatio - 1) * 0.15,
  0.35, 0.98)` — calm (dramaNorm→0) ≈ legato 0.95; steep/dramatic (dramaNorm→1)
  ≈ staccato ~0.35; power adds a smaller secondary push. Constants tunable to
  land the gate.
- Keep the existing end-of-phrase duration clamp
  (`Math.min(stepDurationSec * articulation, phraseEndTimeSec - onset.time)`).

### 2. Off-grid microtiming (humanize onset times)
Add a small DETERMINISTIC per-onset time offset so onsets sit just off the grid:
- `const MAX_OFFSET = 0.12 * stepDurationSec` (tunable).
- Deterministic pseudo-random offset in [-MAX_OFFSET, +MAX_OFFSET], seeded by
  the onset index (NO Math.random / Date.now). Suggested implementation:
  `const seed = Math.sin((i + 1) * 12.9898 + onset.step * 78.233) * 43758.5453;`
  `const humanize = ((seed - Math.floor(seed)) - 0.5) * 2 * MAX_OFFSET;`
- Apply to the note time: `time: onset.time + humanize`.
- Onsets MUST remain time-ordered and non-negative: MAX_OFFSET (0.12·step) is far
  below the 1-step minimum gap, but clamp `onset.time + humanize` to
  `>= previous emitted time + 1e-4` and `>= currentTimeSec` to be safe.
- Do NOT let a humanized time push a note past `phraseEndTimeSec`; the existing
  duration clamp already bounds duration, but compute duration from the
  humanized time.

Velocity, pitch, accent logic UNCHANGED.

## Acceptance (bars64; run `npm run musicality`)
Per fixture, melody:
- **`gateLengthStd` >= 0.16** (from 0.086–0.105) — real note-length variety.
- **`offGridDeviation` in [0.03, 0.15]** (from ~0.004) — humanized but not
  sloppy. Must be a clear presence AND stay under the ceiling.
- GUARDRAILS — Cycle 5 pitch gains preserved EXACTLY (pitch is untouched, so
  these must not move): `intervalLeap` in [0.06, 0.30]; `fourGramRepeatRate`
  <= 0.50; `consecutiveRepeatRate` <= 0.35; `inScaleRate` = 1.0.
- GUARDRAILS — structure: `noteCount` within ±2% of baseline bars64 (offset/
  duration only, no onset add/remove); `musicDurationMin` within ±5%; `bpmRange`
  identical to baseline.
- `velocityStd` >= 0.09 (dynamics preserved).

Full mode: check only `inScaleRate` = 1.0 and `musicDurationMin`/`bpmRange`
unchanged vs baseline full.

`npm run typecheck` and `npm run build` pass.

## Build contract
Do NOT commit. Leave changes in the working tree and report the full per-fixture
bars64 metric table (both new metrics + all guardrail metrics) so the spec author
can verify against the gates and run the listening UAT before re-baselining.
`npm run musicality` is slow (~2–3 min); let it finish. If a gate cannot be met
without violating a guardrail (especially inScaleRate=1.0, noteCount ±2%, or the
Cycle 5 pitch gates), STOP and report the conflict — do not loosen a guardrail.

## Explicit non-goals (future work)
- No percussion swing/humanize (drums stay on-grid this cycle — separate follow-up;
  the perc `offGridDeviation` metric exists but is not gated here).
- No swing groove (intentional long-short) — that is a different feature and the
  offGrid metric deliberately excludes it. This cycle is humanize/jitter only.
- No new pitch or data-signal mapping (Cycle 5 / future multi-signal cycle).
