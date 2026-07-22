export interface RidePoint {
  timestamp: number;
  cadence?: number;
  speed?: number;
  altitude?: number;
  heartRate?: number;
  power?: number;
  lat?: number;
  lng?: number;
}

export interface ParsedRide {
  points: RidePoint[];
  name?: string;
  sport?: string;
  format: 'fit' | 'gpx' | 'tcx';
}

export type DataStatus = 'recorded' | 'estimated' | 'unavailable';

export interface DataAvailability {
  cadence: DataStatus;
  speed: DataStatus;
  altitude: DataStatus;
  heartRate: DataStatus;
  power: DataStatus;
}

export interface NormalizedPoint {
  timestamp: number;
  cadence: number;
  speed: number;
  altitude: number;
  heartRate: number;
  power: number;
  lat?: number;
  lng?: number;
}

export interface NormalizedRide {
  points: NormalizedPoint[];
  availability: DataAvailability;
  name?: string;
  sport?: string;
  durationSeconds: number;
  distanceMeters: number;
  elevationGain: number;
}

export type MusicalKey = 'C' | 'Db' | 'D' | 'Eb' | 'E' | 'F' | 'F#' | 'G' | 'Ab' | 'A' | 'Bb' | 'B';
export type MusicalMode = 'major' | 'minor' | 'pentatonic';

export interface MidiConfig {
  key: MusicalKey;
  mode: MusicalMode;
  tempoMin: number;
  tempoMax: number;
  rhythmicSensitivity: number;
  targetBars: number | null;
  stepsPerBar: number;
}

export interface ConversionResult {
  midiBytes: Uint8Array;
  noteCount: number;
  durationSeconds: number;
  bpmRange: [number, number];
}
