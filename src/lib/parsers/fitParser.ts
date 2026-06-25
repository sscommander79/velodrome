import { ParsedRide, RidePoint } from '../types';

async function decompressGzip(buffer: ArrayBuffer): Promise<ArrayBuffer> {
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
  return result.buffer;
}

export async function parseFitFile(file: File): Promise<ParsedRide> {
  let buffer: ArrayBuffer = await file.arrayBuffer();
  const isGzip = file.name.endsWith('.gz');
  if (isGzip) {
    buffer = await decompressGzip(buffer);
  }

  const FitParser = (await import('fit-file-parser')).default;

  return new Promise((resolve, reject) => {
    const parser = new FitParser({
      force: true,
      speedUnit: 'ms',
      lengthUnit: 'm',
      temperatureUnit: 'celsius',
      elapsedRecordField: true,
      mode: 'list',
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    parser.parse(buffer as any, (error: string | undefined, data: any) => {
      if (error) { reject(new Error(error)); return; }

      const records = (data?.records as Record<string, unknown>[]) || [];
      const sessionData = (data?.sessions as Record<string, unknown>[])?.[0];

      const points: RidePoint[] = records
        .filter((r) => r?.timestamp != null)
        .map((r) => {
          const ts = r.timestamp instanceof Date
            ? r.timestamp.getTime()
            : typeof r.timestamp === 'number'
              ? r.timestamp * 1000
              : new Date(r.timestamp as string).getTime();

          const lat = (r.position_lat as number | undefined);
          const lng = (r.position_long as number | undefined);

          return {
            timestamp: ts,
            cadence: r.cadence as number | undefined,
            speed: r.speed as number | undefined,
            altitude: (r.altitude ?? r.enhanced_altitude) as number | undefined,
            heartRate: r.heart_rate as number | undefined,
            power: r.power as number | undefined,
            lat: lat != null ? lat / 11930465 : undefined,
            lng: lng != null ? lng / 11930465 : undefined,
          };
        })
        .filter((p) => !isNaN(p.timestamp));

      const name = (sessionData?.sport as string) || undefined;
      resolve({ points, name, sport: name, format: 'fit' });
    });
  });
}
