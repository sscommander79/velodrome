import type { NormalizedPoint } from '../types';

export interface RideWindow {
  start: number;
  end: number;
  score: number;
}

interface ScoredCandidate extends RideWindow {
  index: number;
}

interface RawComponents {
  sustainedGrad: number;
  gradShift: number;
  speedVar: number;
  hrDelta: number;
}

function equalWindows(pointCount: number, windowCount: number, score: number): RideWindow[] {
  if (pointCount === 0) {
    return Array.from({ length: windowCount }, () => ({ start: 0, end: 0, score }));
  }

  return Array.from({ length: windowCount }, (_, i) => {
    const start = Math.floor((i * pointCount) / windowCount);
    const end =
      i === windowCount - 1
        ? pointCount
        : Math.max(start + 1, Math.floor(((i + 1) * pointCount) / windowCount));
    return { start, end, score };
  });
}

function stddev(values: number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

function gradient(points: NormalizedPoint[], start: number, end: number): number {
  if (end <= start) return 0;
  return (points[end - 1].altitude - points[start].altitude) / (end - start);
}

function rawComponents(points: NormalizedPoint[], start: number, end: number): RawComponents {
  const windowLen = end - start;
  const mid = start + Math.floor(windowLen / 2);
  const speeds: number[] = [];
  let minHr = Infinity;
  let maxHr = -Infinity;

  for (let i = start; i < end; i++) {
    speeds.push(points[i].speed);
    minHr = Math.min(minHr, points[i].heartRate);
    maxHr = Math.max(maxHr, points[i].heartRate);
  }

  return {
    sustainedGrad: Math.abs(points[end - 1].altitude - points[start].altitude) / windowLen,
    gradShift: Math.abs(gradient(points, mid, end) - gradient(points, start, mid)),
    speedVar: stddev(speeds),
    hrDelta: maxHr - minHr,
  };
}

function normalized(value: number, max: number): number {
  return max > 0 ? value / max : 0;
}

export function selectHighlights(points: NormalizedPoint[], numPhrases: number): RideWindow[] {
  if (numPhrases <= 0) return [];
  if (points.length === 0) return equalWindows(0, numPhrases, 0);

  const numCandidates = numPhrases * 4;
  if (points.length < numCandidates * 2) {
    return equalWindows(points.length, numPhrases, 0);
  }

  const starts = Array.from({ length: numCandidates }, (_, i) =>
    Math.floor((i * points.length) / numCandidates)
  );
  const ends = Array.from({ length: numCandidates }, (_, i) =>
    i === numCandidates - 1
      ? points.length
      : Math.floor(((i + 1) * points.length) / numCandidates)
  );
  const raw = starts.map((start, i) => rawComponents(points, start, ends[i]));
  const maxes = raw.reduce<RawComponents>(
    (acc, cur) => ({
      sustainedGrad: Math.max(acc.sustainedGrad, cur.sustainedGrad),
      gradShift: Math.max(acc.gradShift, cur.gradShift),
      speedVar: Math.max(acc.speedVar, cur.speedVar),
      hrDelta: Math.max(acc.hrDelta, cur.hrDelta),
    }),
    { sustainedGrad: 0, gradShift: 0, speedVar: 0, hrDelta: 0 }
  );

  const candidates: ScoredCandidate[] = raw.map((components, index) => ({
    index,
    start: starts[index],
    end: ends[index],
    score:
      0.35 * normalized(components.sustainedGrad, maxes.sustainedGrad) +
      0.25 * normalized(components.gradShift, maxes.gradShift) +
      0.25 * normalized(components.speedVar, maxes.speedVar) +
      0.15 * normalized(components.hrDelta, maxes.hrDelta),
  }));

  const selected = new Map<number, ScoredCandidate>();
  selected.set(0, candidates[0]);
  if (numPhrases >= 2) selected.set(numCandidates - 1, candidates[numCandidates - 1]);

  const interiors = candidates.slice(1, -1);
  if (numPhrases >= 3 && interiors.length > 0) {
    const lowestInterior = [...interiors].sort((a, b) => a.score - b.score || a.index - b.index)[0];
    selected.set(lowestInterior.index, lowestInterior);
  }

  const topInteriors = [...interiors].sort((a, b) => b.score - a.score || a.index - b.index);
  for (const candidate of topInteriors) {
    if (selected.size >= numPhrases) break;
    selected.set(candidate.index, candidate);
  }

  return [...selected.values()]
    .sort((a, b) => a.start - b.start || a.end - b.end)
    .map(({ start, end, score }) => ({ start, end, score }));
}
