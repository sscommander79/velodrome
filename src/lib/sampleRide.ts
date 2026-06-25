import { NormalizedRide, NormalizedPoint } from "@/lib/types";

// Generates a synthetic ~20 min ride with rolling hills, varying speed and
// cadence so every downstream feature (charts, MIDI, Digitakt panel) has
// interesting data to work with. Used by the "Load sample ride" button.
export function buildSampleRide(): NormalizedRide {
  const totalSeconds = 1200; // 20 minutes
  const points: NormalizedPoint[] = [];
  const start = Date.now();

  let distance = 0;
  let elevationGain = 0;
  let prevAltitude = 100;

  for (let t = 0; t < totalSeconds; t++) {
    const phase = t / totalSeconds;

    // Rolling hill profile: two big climbs + descents
    const altitude =
      100 +
      60 * Math.sin(phase * Math.PI * 2) +
      35 * Math.sin(phase * Math.PI * 6) +
      10 * Math.sin(t / 13);

    // Speed inversely related to gradient — slower uphill, faster downhill
    const gradient = altitude - prevAltitude;
    const speed = Math.max(2, 9 - gradient * 1.5 + Math.sin(t / 7) * 1.2); // m/s

    // Cadence drops on steep climbs (creating rests in the pattern)
    const cadence = gradient > 1.2 ? Math.max(0, 45 - gradient * 8) : 78 + Math.sin(t / 5) * 10;

    const heartRate = 130 + Math.round(30 * Math.sin(phase * Math.PI) + gradient * 4);
    const power = Math.max(80, 180 + gradient * 25 + Math.sin(t / 9) * 30);

    distance += speed;
    if (altitude > prevAltitude) elevationGain += altitude - prevAltitude;
    prevAltitude = altitude;

    points.push({
      timestamp: start + t * 1000,
      cadence: Math.round(cadence),
      speed: Number(speed.toFixed(2)),
      altitude: Number(altitude.toFixed(1)),
      heartRate: Math.round(heartRate),
      power: Math.round(power),
    });
  }

  return {
    points,
    availability: {
      cadence: "recorded",
      speed: "recorded",
      altitude: "recorded",
      heartRate: "recorded",
      power: "recorded",
    },
    name: "Sample Hill Loop",
    sport: "cycling",
    durationSeconds: totalSeconds,
    distanceMeters: Math.round(distance),
    elevationGain: Math.round(elevationGain),
  };
}
