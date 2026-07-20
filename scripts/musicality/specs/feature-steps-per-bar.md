# Feature — user-selectable steps per bar (grid resolution)

## Goal
Expose the currently-hardcoded `STEPS_PER_BAR = 16` as a user option (8 / 16 /
32) so the melodic/rhythmic grid can be coarser (8 = 8th-note grid) or finer
(32 = 32nd-note grid). This is a FEATURE, not a musicality cycle: it gates on
regression safety (zero drift at the default), not on boringness metrics.

## Scope
- `src/lib/types.ts` — add `stepsPerBar: number` to `MidiConfig`.
- `src/lib/midi/converter.ts` — replace the module constant `STEPS_PER_BAR`
  with `config.stepsPerBar`, and de-hardcode every 16-step assumption (below).
- `src/components/ConfigurationPanel.tsx` — add a select (8/16/32, default 16)
  next to the existing "Length" control; wire it into the config object exactly
  as `targetBars` is wired.
- Wherever `MidiConfig` objects are constructed with a default (e.g.
  `src/pages/Home.tsx`), set `stepsPerBar: 16`.
- Do NOT touch the Digitakt segmenter (`segmenter.ts`) — the DT export keeps its
  own 16-step reality for now (separate follow-up). Do NOT touch euclidean.ts,
  scales.ts, highlights.ts, the harness, or MidiConfig fields other than adding
  `stepsPerBar`.

## The 16-step assumptions to de-hardcode
Let `S = config.stepsPerBar`. All of these currently assume S = 16:

1. **Step duration (CRITICAL — timing).** Both `emitPhrase` (~line 116) and
   `addPercussionPhrase` (~line 303) compute `stepDuration = beatDuration / 4`
   (i.e. 4 steps per beat = 16/bar). Replace with grid-derived timing:
   `stepDuration = barDuration / S` (barDuration = beatDuration ·
   BEATS_PER_BAR). At S=16 this equals beatDuration/4 exactly — verify.
2. **Euclidean pattern length.** `euclideanPattern(pulses, STEPS_PER_BAR, ...)`
   → `S`. Euclid requires `pulses <= steps`: the melody pulse clamp
   `clamp(round(3 + ...·9), 3, 12)` can exceed S when S=8 — change the upper
   bound to `min(12, S)`. Kick `clamp(2 + round(powerNorm·3), 2, 5)` → cap at
   `min(5, S)`.
3. **Step loops.** `for (step = 0; step < STEPS_PER_BAR; step++)` → `< S` (melody
   ~line 131, percussion ~line 344).
4. **pos calc** (melody ~line 135) already uses STEPS_PER_BAR → use S.
5. **Phrase-half split** (melody `firstOnsetInHalf`, `step < 8` / `>= 8`) →
   `step < S/2` / `>= S/2`.
6. **Percussion fixed positions** — scale proportionally so the GROOVE is
   identical at any resolution:
   - Snare backbeat `step === 4 || step === 12` → `step === S/4 || step === 3·S/4`
     (beats 2 and 4).
   - Ghost snare `step === 15` → `step === S - 1`.
   - Fill `step >= 12` (last quarter) → `step >= 3·S/4`; the fill uses 4 velocity
     values `[0.4,0.5,0.65,0.8]` indexed by `step - 12` — re-index by
     `step - 3·S/4` and, if the last quarter has more/fewer than 4 steps, index
     into the array by fractional position (`floor((step - 3·S/4) / (S/4) *
     4)`) clamped to `[0,3]`, so it works at any S.
   - Hi-hat: currently every 2nd step (8th notes at S=16) with the last-offbeat
     accent at `step === 14`. Keep the hi-hat on an 8th-note pulse regardless of
     resolution: fire every `hatEvery = max(1, S/8)` steps; on-beat accent when
     `step % (S/4) === 0`; last-offbeat = the final hat position of the bar
     (`step === S - hatEvery`).
   All of `S/4`, `S/2`, `3·S/4`, `S/8` are integers for S ∈ {8,16,32} — but
   guard with `Math.round` / `Math.floor` so no fractional step index leaks.

## Acceptance
- **Zero drift at default (the hard gate):** with `stepsPerBar: 16`, `npm run
  musicality` must produce a scoreboard IDENTICAL to committed
  `scripts/musicality/baseline.json` for BOTH lengths, all fixtures, all metrics
  (noteCount, intervalLeap, every field). The refactor must not change 16-step
  output at all. If any metric drifts at S=16, a proportional formula is wrong —
  fix it, do not re-baseline.
- S=8 and S=32 render without error and produce valid MIDI: `inScaleRate` = 1.0,
  Euclidean pulses ≤ S, no zero/negative durations, `bpmRange` unchanged from
  S=16 (BPM logic is independent of grid). Report noteCount at S=8/16/32 per
  fixture (expect roughly: fewer notes at 8, more at 32).
- `npm run typecheck` and `npm run build` pass.
- UI: the select shows 8/16/32, defaults to 16, and a changed value flows into
  the generated MIDI (state wired like `targetBars`).

## Build contract
Do NOT commit. Leave changes in the working tree and report: the diff summary,
the S=16 zero-drift confirmation (diff the fresh scoreboard against
baseline.json — must be empty), and the S=8/16/32 noteCount table. If S=16
drift cannot be eliminated, STOP and report which formula diverges rather than
re-baselining or loosening the gate.
