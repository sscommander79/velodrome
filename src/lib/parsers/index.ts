import { ParsedRide } from '../types';
import { parseFitFile } from './fitParser';
import { parseGpxFile, parseTcxFile } from './gpxParser';

export async function parseFile(file: File): Promise<ParsedRide> {
  const name = file.name.toLowerCase();

  if (name.endsWith('.fit') || name.endsWith('.fit.gz')) {
    return parseFitFile(file);
  }
  if (name.endsWith('.gpx') || name.endsWith('.gpx.gz')) {
    return parseGpxFile(file);
  }
  if (name.endsWith('.tcx') || name.endsWith('.tcx.gz')) {
    return parseTcxFile(file);
  }

  const isBinary = await isFitBinary(file);
  if (isBinary) return parseFitFile(file);

  return parseGpxFile(file);
}

async function isFitBinary(file: File): Promise<boolean> {
  try {
    const slice = await file.slice(0, 12).arrayBuffer();
    if (slice.byteLength < 12) return false;
    const view = new DataView(slice);
    return (
      view.getUint8(8) === 0x2e &&
      view.getUint8(9) === 0x46 &&
      view.getUint8(10) === 0x49 &&
      view.getUint8(11) === 0x54
    );
  } catch {
    return false;
  }
}

export { parseFitFile } from './fitParser';
export { parseGpxFile, parseTcxFile } from './gpxParser';
