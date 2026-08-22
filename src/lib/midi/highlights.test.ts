import { describe, it, expect } from 'vitest';
import { selectHighlights } from './highlights';
import type { NormalizedPoint } from '@/lib/types';

function pt(i: number, altitude: number, speed = 8, heartRate = 140): NormalizedPoint {
  return { timestamp: i * 1000, cadence: 85, speed, altitude, heartRate, power: 200 };
}

// Build a ride that is flat/dull for most of its length but has one dramatic
// interior climb+descent spike. The interesting-window selector must include
// that spike, not skip it.
function rideWithInteriorSpike(): NormalizedPoint[] {
  const points: NormalizedPoint[] = [];
  const n = 800;
  for (let i = 0; i < n; i++) {
    // Flat baseline everywhere...
    let alt = 100;
    let spd = 8;
    let hr = 140;
    // ...except a sharp, high-variance event around 45-55% through.
    if (i > n * 0.45 && i < n * 0.55) {
      const t = (i - n * 0.45) / (n * 0.1);
      alt = 100 + Math.sin(t * Math.PI) * 120; // big climb then drop
      spd = 8 + Math.sin(t * Math.PI * 6) * 6; // choppy speed
      hr = 140 + Math.sin(t * Math.PI) * 40;
    }
    points.push(pt(i, alt, spd, hr));
  }
  return points;
}

describe('selectHighlights — interestingness selection (inverted-sort bug fix)', () => {
  it('returns the requested number of windows, sorted and non-overlapping', () => {
    const points = rideWithInteriorSpike();
    const windows = selectHighlights(points, 8);
    expect(windows).toHaveLength(8);
    for (let i = 1; i < windows.length; i++) {
      expect(windows[i].start).toBeGreaterThanOrEqual(windows[i - 1].start);
    }
    for (const w of windows) {
      expect(w.end).toBeGreaterThan(w.start);
    }
  });

  it('anchors the ride opening and closing windows', () => {
    const points = rideWithInteriorSpike();
    const windows = selectHighlights(points, 6);
    expect(windows[0].start).toBe(0);
    expect(windows[windows.length - 1].end).toBe(points.length);
  });

  it('INCLUDES the dramatic interior spike (not the dullest window)', () => {
    const points = rideWithInteriorSpike();
    const windows = selectHighlights(points, 6);
    // The spike lives at ~45-55% of the ride. At least one selected interior
    // window must overlap that region. Before the fix, the selector force-seeded
    // the LOWEST-scored interior window, so it tended to pick a flat stretch.
    const spikeStart = points.length * 0.45;
    const spikeEnd = points.length * 0.55;
    const overlapsSpike = windows.some(
      (w) => w.start < spikeEnd && w.end > spikeStart,
    );
    expect(overlapsSpike).toBe(true);
  });

  it('prefers higher-scoring interior windows over lower-scoring ones', () => {
    // With few phrases, the single interior pick should be the high-variance
    // spike window, whose score exceeds the flat windows around it.
    const points = rideWithInteriorSpike();
    const windows = selectHighlights(points, 3);
    const interior = windows.slice(1, -1);
    expect(interior.length).toBeGreaterThan(0);
    // Every flat baseline window scores ~0; the chosen interior must beat that.
    for (const w of interior) {
      expect(w.score).toBeGreaterThan(0);
    }
  });

  it('degrades gracefully on tiny / empty rides', () => {
    expect(selectHighlights([], 4)).toHaveLength(4);
    expect(() => selectHighlights([pt(0, 100), pt(1, 101)], 4)).not.toThrow();
  });
});
