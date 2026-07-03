# Cycle 3 — Interestingness-weighted compression (highlight selection)

## Problem (Steven's insight, 2026-07-02)
Compressed mode slices the ride into EQUAL point ranges, so a brutal
10-minute climb gets the same 12 seconds of music as any random flat
stretch. Uniform compression averages away exactly the drama that makes a
ride worth sonifying. The system should find significant variations, score
them as interesting, and build the piece from those — a highlight reel, not
a time-lapse.

## Scope
- New module `src/lib/midi/highlights.ts` + wiring in the COMPRESSED driver
  of `src/lib/midi/converter.ts` (replaces the equal-slice computation only).
- Full-ride mode (`targetBars === null`) untouched.
- No UI or MidiConfig changes. emitPhrase untouched. Deterministic — no
  Math.random / Date.now.

## Changes

### 1. `src/lib/midi/highlights.ts`
```
export interface RideWindow { start: number; end: number; score: number }
export function selectHighlights(
  points: NormalizedPoint[],
  numPhrases: number
): RideWindow[]
```
- Split the ride into `numCandidates = numPhrases * 4` equal contiguous
  windows (each at least 2 points; if points.length < numCandidates * 2,
  fall back to numPhrases equal windows with score 0 — degenerate short
  rides must still work).
- Score each window on four normalized components (each divided by its max
  across all windows; a component whose max is 0 contributes 0):
  - `sustainedGrad` = |alt(end-1) - alt(start)| / windowLen  — climbing or
    descending hard
  - `gradShift` = |grad(secondHalf) - grad(firstHalf)|       — cresting a
    hill, starting a descent
  - `speedVar`  = stddev(speeds in window)                    — sprints,
    corners, stops
  - `hrDelta`   = max(hr) - min(hr) in window                 — effort spikes
  - `score = 0.35*sustainedGrad + 0.25*gradShift + 0.25*speedVar + 0.15*hrDelta`
- Selection (`numPhrases` windows total):
  - ALWAYS include the first and the last window (the ride's start and end
    anchor the narrative).
  - Include the single LOWEST-scoring interior window (breathing room —
    contrast is what makes highlights land).
  - Fill the remaining `numPhrases - 3` slots with the top-scoring interior
    windows not already selected.
  - Return selected windows sorted by `start` (chronological order — the
    piece still tells the ride start-to-finish).

### 2. Converter compressed driver
Replace the equal-slice `start`/`end` computation with
`selectHighlights(points, numPhrases)`; each returned window's [start, end)
feeds the existing `emitPhrase` with BPM from the window's average speed
(unchanged logic otherwise, including yield/onProgress cadence).

## Acceptance (learned lesson: NO cross-regime comparison gates — selection
changes the data regime, so most melody metrics are simply expected to move)
Hard gates only, bars64 per fixture (`npm run musicality`):
- inScaleRate = 1.0
- restRatio in [0.30, 0.70]
- musicDurationMin in [1, 6]
- noteCount within ±25% of baseline bars64
- Full mode: zero drift vs baseline full (proves null path untouched)
- `npm run typecheck` and `npm run build` pass
Structural checks (report, not gated):
- Print per fixture: selected window indices + scores; verify strictly
  chronological; first/last windows present.
Do not commit; leave changes in the working tree; report metrics + the
selection tables.
