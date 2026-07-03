export function euclideanPattern(pulses: number, steps: number, rotation = 0): boolean[] {
  if (steps <= 0) return [];

  const clampedPulses = Math.max(0, Math.min(steps, Math.round(pulses)));
  if (clampedPulses === 0) return Array(steps).fill(false);
  if (clampedPulses === steps) return Array(steps).fill(true);

  const pattern: boolean[] = [];
  const counts: number[] = [];
  const remainders: number[] = [clampedPulses];
  let divisor = steps - clampedPulses;
  let level = 0;

  while (remainders[level] > 1) {
    counts.push(Math.floor(divisor / remainders[level]));
    remainders.push(divisor % remainders[level]);
    divisor = remainders[level];
    level++;
  }
  counts.push(divisor);

  function build(currentLevel: number): void {
    if (currentLevel === -1) {
      pattern.push(false);
      return;
    }
    if (currentLevel === -2) {
      pattern.push(true);
      return;
    }

    for (let i = 0; i < counts[currentLevel]; i++) {
      build(currentLevel - 1);
    }
    if (remainders[currentLevel] !== 0) {
      build(currentLevel - 2);
    }
  }

  build(level);

  const firstOnset = pattern.indexOf(true);
  const canonical = rotateLeft(pattern, firstOnset < 0 ? 0 : firstOnset);
  return rotateLeft(canonical, rotation);
}

function rotateLeft(pattern: boolean[], rotation: number): boolean[] {
  if (pattern.length === 0) return pattern;
  const normalized = ((Math.round(rotation) % pattern.length) + pattern.length) % pattern.length;
  return pattern.slice(normalized).concat(pattern.slice(0, normalized));
}
