# Cycle 4 — Harmony: gradient-colored arpeggio track (MIDI/DAW path only)

## Problem
The piece is melody + drums only. A harmonic layer gives it emotional
movement — tension on climbs, release on descents. Constraint (Steven,
locked): the Digitakt has no chord mode, so harmony lives ONLY in the MIDI
file for DAW use. The segmenter/Digitakt path must not change.

## Scope
- `src/lib/midi/converter.ts`: add a THIRD track "Harmony (Gradient)"
  (any channel except 9). Melody and percussion logic byte-untouched —
  harmony is purely additive.
- Harness: minimally extend to score the harmony track; melody/percussion
  scoreboard sections must keep their exact current shape.
- Do NOT touch segmenter.ts, euclidean.ts, highlights.ts, scales.ts, UI,
  MidiConfig, baseline.json. Deterministic — no Math.random / Date.now.

## Changes

### 1. Per-phrase chord (inside emitPhrase, alongside existing logic)
- `degreesPerOctave` = 7 for major/minor, 5 for pentatonic (derive from the
  scale intervals length, don't hardcode a mode check).
- Chord root index = the phrase's base pitch index (scaleNotes index of
  elevationToPitch(phrase avgAlt)) minus `degreesPerOctave` (one octave
  below the melody register), clamped to keep the whole chord in bounds.
- Diatonic stack: chord tone indices [root, root+2, root+4] within
  scaleNotes (automatically the right quality for the scale position;
  always in-scale by construction).
- Gradient color, using the phrase's overall gradient
  (alt(end-1) - alt(start)):
  - climbing (> +3 m): add root+6 as a 4th chord tone (diatonic 7th —
    tension)
  - descending (< -3 m): plain triad (release)
  - flat: replace root+2 with root+3 (diatonic sus — suspension)

### 2. Arpeggio rendering
- 8th notes across the phrase (2 per beat, same grid/timing conventions as
  percussion hats), cycling through the chord tones.
- Direction from the phrase's speed trend (avg of second half vs first half
  of the phrase's speeds): accelerating -> ascending cycle, decelerating ->
  descending, steady (within ±5%) -> up-down ping-pong.
- Note duration 0.9 * eighth (gentle legato), clamped to phrase end.
- Velocity: phrase HR velocity - 0.12, +0.08 on beat-1 of each bar,
  clamp [0.05, 0.9] — it's a background layer.

## Acceptance
- `npm run typecheck` and `npm run build` pass.
- MELODY and PERCUSSION scoreboard sections: ZERO drift vs baseline in BOTH
  modes (proves harmony is purely additive and the Digitakt path untouched —
  segmentRide output feeds digitaktSteps, which must also show zero drift).
- New harmony section (bars64 per fixture): inScaleRate = 1.0;
  noteCount > 0; velocityStd > 0 (accents present).
- Report per-fixture harmony metrics + a sample of chord qualities chosen
  (how many climb/descend/flat phrases per fixture).
Do not commit; leave changes in the working tree.
