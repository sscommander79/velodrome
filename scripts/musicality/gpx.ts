// Minimal Node-side GPX reader for the musicality harness.
// The app's gpxParser needs the browser DOMParser; this reader keeps the
// harness runnable in plain Node. It only needs to handle StravaGPX track
// files (lat/lon/ele/time plus optional gpxtpx extensions).
import { readFileSync } from 'node:fs';
import type { ParsedRide, RidePoint } from '../../src/lib/types';

function tag(block: string, name: string): string | undefined {
  const m = block.match(new RegExp(`<(?:\\w+:)?${name}[^>]*>([^<]+)</(?:\\w+:)?${name}>`));
  return m?.[1];
}

function num(v: string | undefined): number | undefined {
  if (v == null || v === '') return undefined;
  const n = parseFloat(v);
  return isNaN(n) ? undefined : n;
}

export function readGpx(path: string): ParsedRide {
  const text = readFileSync(path, 'utf8');
  const name = text.match(/<name>([^<]+)<\/name>/)?.[1];

  const blocks = text.match(/<trkpt[\s\S]*?<\/trkpt>/g) ?? [];
  const hasAnyTime = blocks.some((b) => tag(b, 'time'));

  const points: RidePoint[] = blocks.map((b, idx) => {
    const lat = num(b.match(/lat="([^"]+)"/)?.[1]);
    const lng = num(b.match(/lon="([^"]+)"/)?.[1]);
    const timeStr = tag(b, 'time');
    // Same fallback as the app parser: no <time> anywhere -> synthetic 1 Hz.
    const timestamp = timeStr
      ? new Date(timeStr).getTime()
      : hasAnyTime
        ? NaN
        : idx * 1000;

    return {
      timestamp,
      altitude: num(tag(b, 'ele')),
      heartRate: num(tag(b, 'hr')),
      cadence: num(tag(b, 'cad')),
      speed: num(tag(b, 'speed')),
      power: num(tag(b, 'power')),
      lat,
      lng,
    };
  }).filter((p) => !isNaN(p.timestamp));

  return { points, name, format: 'gpx' };
}
