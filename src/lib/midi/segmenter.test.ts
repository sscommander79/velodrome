import { describe, it, expect } from 'vitest';
import { segmentRide } from './segmenter';
import type { MidiConfig, NormalizedRide, NormalizedPoint } from '@/lib/types';

const CONFIG: MidiConfig = {
  key: 'C',
  mode: 'minor',
  tempoMin: 60,
  tempoMax: 160,
  rhythmicSensitivity: 0.5,
  targetBars: 64,
  stepsPerBar: 16,
};

function syntheticRide(n: number): NormalizedRide {
  const points: NormalizedPoint[] = Array.from({ length: n }, (_, i) => ({
    timestamp: i * 1000,
    cadence: 80 + (i % 20),
    speed: 5 + (i % 10),
    altitude: 100 + Math.sin(i / 50) * 40, // rolling terrain
    heartRate: 130 + (i % 30),
    power: 150 + (i % 60),
  }));
  return {
    points,
    availability: {
      cadence: 'recorded', speed: 'recorded', altitude: 'recorded',
      heartRate: 'recorded', power: 'recorded',
    },
    durationSeconds: n,
    distanceMeters: n * 7,
    elevationGain: 500,
  };
}

describe('segmentRide — long-ride stack-overflow regression', () => {
  it('does NOT throw on a very long ride (the Math.min(...spread) bug)', () => {
    // 200k points ≈ a 55-hour 1 Hz ride — well past the JS argument-spread
    // limit that made Math.min(...altitudes) throw before the fix. If the fix
    // regresses, this line throws "Maximum call stack size exceeded".
    const ride = syntheticRide(200_000);
    expect(() => segmentRide(ride, 64, CONFIG)).not.toThrow();
  });

  it('returns exactly stepCount steps with valid MIDI/velocity ranges', () => {
    const ride = syntheticRide(5000);
    const steps = segmentRide(ride, 32, CONFIG);
    expect(steps).toHaveLength(32);
    for (const s of steps) {
      expect(s.note).toBeGreaterThanOrEqual(0);
      expect(s.note).toBeLessThanOrEqual(127);
      expect(s.velocity).toBeGreaterThanOrEqual(1);
      expect(s.velocity).toBeLessThanOrEqual(127);
      expect(s.length).toBeGreaterThanOrEqual(0);
      expect(s.length).toBeLessThanOrEqual(127);
      expect(typeof s.active).toBe('boolean');
    }
  });

  it('handles an empty ride without throwing', () => {
    const ride = syntheticRide(0);
    expect(() => segmentRide(ride, 16, CONFIG)).not.toThrow();
  });

  it('quantizes every note into the configured scale', () => {
    // C minor pitch classes: C D Eb F G Ab Bb = 0,2,3,5,7,8,10
    const allowed = new Set([0, 2, 3, 5, 7, 8, 10]);
    const ride = syntheticRide(2000);
    const steps = segmentRide(ride, 64, CONFIG);
    for (const s of steps) {
      expect(allowed.has(((s.note % 12) + 12) % 12)).toBe(true);
    }
  });
});
