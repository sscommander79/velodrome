import { ParsedRide, RidePoint } from '../types';

async function readFileText(file: File): Promise<string> {
  if (file.name.endsWith('.gz')) {
    const buffer = await file.arrayBuffer();
    const ds = new DecompressionStream('gzip');
    const writer = ds.writable.getWriter();
    const reader = ds.readable.getReader();
    writer.write(new Uint8Array(buffer));
    writer.close();
    const chunks: Uint8Array[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
    const total = chunks.reduce((sum, c) => sum + c.length, 0);
    const result = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) { result.set(c, offset); offset += c.length; }
    return new TextDecoder().decode(result);
  }
  return file.text();
}

function safeFloat(val: string | null | undefined): number | undefined {
  if (val == null || val === '') return undefined;
  const n = parseFloat(val);
  return isNaN(n) ? undefined : n;
}

function safeInt(val: string | null | undefined): number | undefined {
  if (val == null || val === '') return undefined;
  const n = parseInt(val, 10);
  return isNaN(n) ? undefined : n;
}

export async function parseGpxFile(file: File): Promise<ParsedRide> {
  const text = await readFileText(file);
  const parser = new DOMParser();
  const doc = parser.parseFromString(text, 'application/xml');

  const name = doc.querySelector('name')?.textContent ?? undefined;

  const trkpts = Array.from(doc.querySelectorAll('trkpt'));

  const points: RidePoint[] = trkpts.map((pt) => {
    const lat = safeFloat(pt.getAttribute('lat'));
    const lng = safeFloat(pt.getAttribute('lon'));
    const ele = safeFloat(pt.querySelector('ele')?.textContent);
    const timeStr = pt.querySelector('time')?.textContent;
    const timestamp = timeStr ? new Date(timeStr).getTime() : NaN;

    const hr =
      safeInt(pt.querySelector('gpxtpx\\:hr')?.textContent) ??
      safeInt(pt.querySelector('hr')?.textContent);

    const cad =
      safeInt(pt.querySelector('gpxtpx\\:cad')?.textContent) ??
      safeInt(pt.querySelector('cad')?.textContent);

    const speedNode =
      pt.querySelector('gpxtpx\\:speed') ??
      pt.querySelector('speed');
    const speed = safeFloat(speedNode?.textContent);

    const powerNode =
      pt.querySelector('gpxtpx\\:power') ??
      pt.querySelector('power');
    const power = safeFloat(powerNode?.textContent);

    return {
      timestamp,
      cadence: cad,
      speed,
      altitude: ele,
      heartRate: hr,
      power,
      lat,
      lng,
    };
  }).filter((p) => !isNaN(p.timestamp));

  return { points, name, format: 'gpx' };
}

export async function parseTcxFile(file: File): Promise<ParsedRide> {
  const text = await readFileText(file);
  const parser = new DOMParser();
  const doc = parser.parseFromString(text, 'application/xml');

  const name = doc.querySelector('Activity > Id')?.textContent ?? undefined;
  const sport = doc.querySelector('Activity')?.getAttribute('Sport') ?? undefined;

  const trackpoints = Array.from(doc.querySelectorAll('Trackpoint'));

  const points: RidePoint[] = trackpoints.map((tp) => {
    const timeStr = tp.querySelector('Time')?.textContent;
    const timestamp = timeStr ? new Date(timeStr).getTime() : NaN;

    const lat = safeFloat(tp.querySelector('LatitudeDegrees')?.textContent);
    const lng = safeFloat(tp.querySelector('LongitudeDegrees')?.textContent);
    const alt = safeFloat(tp.querySelector('AltitudeMeters')?.textContent);
    const hr = safeInt(tp.querySelector('HeartRateBpm Value')?.textContent);
    const cad = safeInt(tp.querySelector('Cadence')?.textContent);
    const speedNode = tp.querySelector('Speed') ?? tp.querySelector('Extensions Speed');
    const speed = safeFloat(speedNode?.textContent);
    const wattsNode =
      tp.querySelector('Watts') ??
      tp.querySelector('Extensions TPX Watts');
    const power = safeFloat(wattsNode?.textContent);

    return {
      timestamp,
      cadence: cad,
      speed,
      altitude: alt,
      heartRate: hr,
      power,
      lat: lat ?? undefined,
      lng: lng ?? undefined,
    };
  }).filter((p) => !isNaN(p.timestamp));

  return { points, name, sport, format: 'tcx' };
}
