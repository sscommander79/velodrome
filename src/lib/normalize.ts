import { ParsedRide, NormalizedRide, NormalizedPoint, DataAvailability, DataStatus, RidePoint } from './types';

function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function rollingAverage(values: number[], window: number): number[] {
  return values.map((_, i) => {
    const start = Math.max(0, i - Math.floor(window / 2));
    const end = Math.min(values.length, i + Math.ceil(window / 2));
    const slice = values.slice(start, end);
    return slice.reduce((a, b) => a + b, 0) / slice.length;
  });
}

function detectStatus(values: (number | undefined)[]): DataStatus {
  const defined = values.filter((v) => v != null && !isNaN(v as number));
  if (defined.length === 0) return 'unavailable';
  if (defined.length / values.length >= 0.3) return 'recorded';
  return 'unavailable';
}

function deriveSpeedFromGps(points: RidePoint[]): number[] {
  return points.map((p, i) => {
    if (i === 0) return 0;
    const prev = points[i - 1];
    if (p.lat == null || p.lng == null || prev.lat == null || prev.lng == null) return 0;
    const dist = haversineMeters(prev.lat, prev.lng, p.lat, p.lng);
    const dtSec = (p.timestamp - prev.timestamp) / 1000;
    if (dtSec <= 0 || dtSec > 30) return 0;
    return dist / dtSec;
  });
}

function deriveCadenceFromSpeed(speedMs: number): number {
  const speedKmh = speedMs * 3.6;
  if (speedKmh < 5) return 50;
  if (speedKmh < 15) return 65;
  if (speedKmh < 25) return 80;
  if (speedKmh < 35) return 90;
  return 100;
}

function deriveAltitudeFromSpeedVariation(speeds: number[], baseAlt = 100): number[] {
  let acc = baseAlt;
  return speeds.map((s, i) => {
    if (i === 0) return baseAlt;
    const delta = (s - speeds[i - 1]) * 2;
    acc = Math.max(0, Math.min(2000, acc + delta));
    return acc;
  });
}

function deriveHrFromSpeed(speedMs: number): number {
  const speedKmh = speedMs * 3.6;
  return Math.min(185, Math.max(80, 80 + speedKmh * 2.5));
}

function deriveHrFromGradient(altitude: number, prevAlt: number, speedMs: number): number {
  const gradient = altitude - prevAlt;
  const base = deriveHrFromSpeed(speedMs);
  return Math.min(185, base + gradient * 3);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpOpt(a: number | undefined, b: number | undefined, t: number): number | undefined {
  if (a == null || b == null) return undefined;
  return lerp(a, b, t);
}

function resampleToPerSecond(points: RidePoint[]): RidePoint[] {
  if (points.length < 2) return points;

  const startMs = points[0].timestamp;
  const endMs = points[points.length - 1].timestamp;
  const totalSec = Math.round((endMs - startMs) / 1000);
  if (totalSec <= 0) return points;

  const resampled: RidePoint[] = [];
  let srcIdx = 0;

  for (let sec = 0; sec <= totalSec; sec++) {
    const targetMs = startMs + sec * 1000;

    while (srcIdx < points.length - 2 && points[srcIdx + 1].timestamp <= targetMs) {
      srcIdx++;
    }

    const p0 = points[srcIdx];
    const p1 = points[Math.min(srcIdx + 1, points.length - 1)];
    const span = p1.timestamp - p0.timestamp;
    const t = span > 0 ? Math.min(1, (targetMs - p0.timestamp) / span) : 0;

    resampled.push({
      timestamp: targetMs,
      cadence: lerpOpt(p0.cadence, p1.cadence, t),
      speed: lerpOpt(p0.speed, p1.speed, t),
      altitude: lerpOpt(p0.altitude, p1.altitude, t),
      heartRate: lerpOpt(p0.heartRate, p1.heartRate, t),
      power: lerpOpt(p0.power, p1.power, t),
      lat: lerpOpt(p0.lat, p1.lat, t),
      lng: lerpOpt(p0.lng, p1.lng, t),
    });
  }

  return resampled;
}

export function normalizeRide(parsed: ParsedRide): NormalizedRide {
  const rawPoints = parsed.points;

  if (rawPoints.length === 0) {
    return {
      points: [],
      availability: {
        cadence: 'unavailable',
        speed: 'unavailable',
        altitude: 'unavailable',
        heartRate: 'unavailable',
        power: 'unavailable',
      },
      name: parsed.name,
      sport: parsed.sport,
      durationSeconds: 0,
      distanceMeters: 0,
      elevationGain: 0,
    };
  }

  const points = resampleToPerSecond(rawPoints);

  const cadenceStatus = detectStatus(points.map((p) => p.cadence));
  const speedStatus = detectStatus(points.map((p) => p.speed));
  const altitudeStatus = detectStatus(points.map((p) => p.altitude));
  const heartRateStatus = detectStatus(points.map((p) => p.heartRate));
  const powerStatus = detectStatus(points.map((p) => p.power));

  const hasGps = points.some((p) => p.lat != null && p.lng != null);

  let speeds: number[];
  let speedAvailability: DataStatus;

  if (speedStatus === 'recorded') {
    speeds = points.map((p) => p.speed ?? 0);
    speedAvailability = 'recorded';
  } else if (hasGps) {
    speeds = deriveSpeedFromGps(points);
    speedAvailability = 'estimated';
  } else {
    const avg = 8.33;
    speeds = points.map(() => avg);
    speedAvailability = 'unavailable';
  }

  const smoothedSpeeds = rollingAverage(speeds, 5);

  let altitudes: number[];
  let altAvailability: DataStatus;

  if (altitudeStatus === 'recorded') {
    const rawAlts = points.map((p) => p.altitude ?? 0);
    altitudes = rollingAverage(rawAlts, 20);
    altAvailability = 'recorded';
  } else {
    altitudes = deriveAltitudeFromSpeedVariation(smoothedSpeeds);
    altAvailability = 'estimated';
  }

  let cadences: number[];
  let cadenceAvailability: DataStatus;

  if (cadenceStatus === 'recorded') {
    cadences = points.map((p) => p.cadence ?? 80);
    cadenceAvailability = 'recorded';
  } else if (speedAvailability === 'unavailable') {
    cadences = points.map(() => 80);
    cadenceAvailability = 'unavailable';
  } else {
    cadences = smoothedSpeeds.map(deriveCadenceFromSpeed);
    cadenceAvailability = 'estimated';
  }

  let heartRates: number[];
  let hrAvailability: DataStatus;

  if (heartRateStatus === 'recorded') {
    heartRates = points.map((p) => p.heartRate ?? 130);
    hrAvailability = 'recorded';
  } else {
    heartRates = altitudes.map((alt, i) =>
      i === 0
        ? deriveHrFromSpeed(smoothedSpeeds[i])
        : deriveHrFromGradient(alt, altitudes[i - 1], smoothedSpeeds[i])
    );
    hrAvailability = speedAvailability === 'unavailable' ? 'estimated' : 'estimated';
  }

  let powers: number[];
  let powerAvailability: DataStatus;

  if (powerStatus === 'recorded') {
    powers = points.map((p) => p.power ?? 0);
    powerAvailability = 'recorded';
  } else {
    powers = smoothedSpeeds.map((s, i) => {
      const gradient = i > 0 ? (altitudes[i] - altitudes[i - 1]) : 0;
      const gradeResistance = Math.max(0, gradient * 9.81 * 75 * 0.1);
      return Math.max(0, s * s * 0.3 + gradeResistance);
    });
    powerAvailability = 'estimated';
  }

  const normalizedPoints: NormalizedPoint[] = points.map((p, i) => ({
    timestamp: p.timestamp,
    cadence: Math.max(0, Math.round(cadences[i])),
    speed: Math.max(0, smoothedSpeeds[i]),
    altitude: altitudes[i],
    heartRate: Math.round(Math.max(50, Math.min(220, heartRates[i]))),
    power: Math.max(0, Math.round(powers[i])),
    lat: p.lat,
    lng: p.lng,
  }));

  const durationSeconds =
    (points[points.length - 1].timestamp - points[0].timestamp) / 1000;

  let distanceMeters = 0;
  for (let i = 1; i < normalizedPoints.length; i++) {
    const p = normalizedPoints[i];
    const prev = normalizedPoints[i - 1];
    const dtSec = (p.timestamp - prev.timestamp) / 1000;
    if (dtSec > 0 && dtSec < 30) {
      distanceMeters += p.speed * dtSec;
    }
  }

  let elevationGain = 0;
  for (let i = 1; i < altitudes.length; i++) {
    const diff = altitudes[i] - altitudes[i - 1];
    if (diff > 0) elevationGain += diff;
  }

  const availability: DataAvailability = {
    cadence: cadenceAvailability,
    speed: speedAvailability,
    altitude: altAvailability,
    heartRate: hrAvailability,
    power: powerAvailability,
  };

  return {
    points: normalizedPoints,
    availability,
    name: parsed.name,
    sport: parsed.sport,
    durationSeconds,
    distanceMeters,
    elevationGain,
  };
}
