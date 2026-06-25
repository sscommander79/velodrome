import { useState, useCallback } from "react";
import { parseFile } from "@/lib/parsers";
import { normalizeRide } from "@/lib/normalize";
import { NormalizedRide } from "@/lib/types";
import { Upload, FlaskConical } from "lucide-react";
import sampleRideUrl from "@/assets/sample_ride.gpx?url";

interface UploadZoneProps {
  onParsed: (ride: NormalizedRide) => void;
  isParsing: boolean;
  onParsingStart: () => void;
  onParsingEnd: () => void;
}

export function UploadZone({ onParsed, isParsing, onParsingStart, onParsingEnd }: UploadZoneProps) {
  const [isDragging, setIsDragging] = useState(false);

  const handleFile = async (file: File) => {
    onParsingStart();
    try {
      const parsed = await parseFile(file);
      const normalized = normalizeRide(parsed);
      onParsed(normalized);
    } catch (err) {
      console.error(err);
      alert("Failed to parse file. Ensure it's a valid .fit, .gpx, or .tcx file.");
    } finally {
      onParsingEnd();
    }
  };

  const handleLoadSample = async (e: React.MouseEvent) => {
    e.stopPropagation();
    onParsingStart();
    try {
      const res = await fetch(sampleRideUrl);
      const blob = await res.blob();
      const file = new File([blob], "sample_ride.gpx", { type: "application/gpx+xml" });
      const parsed = await parseFile(file);
      const normalized = normalizeRide(parsed);
      onParsed(normalized);
    } catch (err) {
      console.error(err);
      alert("Failed to load sample ride.");
    } finally {
      onParsingEnd();
    }
  };

  const onDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setIsDragging(false);
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [onParsingStart, onParsed]
  );

  const onDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const onDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  return (
    <div className="flex flex-col items-center gap-4 w-full max-w-2xl">
      <div
        data-testid="upload-zone"
        onDrop={onDrop}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onClick={() => document.getElementById("file-upload")?.click()}
        className={`w-full border-2 border-dashed transition-all duration-300 cursor-pointer flex flex-col items-center justify-center p-12 md:p-24 relative overflow-hidden group
          ${isDragging ? "border-primary bg-primary/5 scale-[1.02]" : "border-border bg-card hover:border-primary/50"}
        `}
      >
        <input
          type="file"
          id="file-upload"
          className="hidden"
          accept=".fit,.gpx,.tcx,.gz"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
          }}
        />

        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-primary/5 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-700 pointer-events-none" />

        {isParsing ? (
          <div className="flex flex-col items-center gap-6">
            <div className="w-16 h-16 border-2 border-muted-foreground border-t-primary rounded-full animate-spin" />
            <div className="font-mono text-sm tracking-widest text-primary uppercase">Analyzing Telemetry...</div>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-6 text-center z-10">
            <div className={`p-4 bg-background border border-border transition-colors duration-300 ${isDragging ? 'text-primary border-primary/30' : 'text-muted-foreground'}`}>
              <Upload className="w-8 h-8" strokeWidth={1.5} />
            </div>
            <div>
              <p className="text-xl font-medium uppercase tracking-wide">Select Activity File</p>
              <p className="text-muted-foreground mt-2 font-mono text-sm">Drop .FIT, .GPX, or .TCX</p>
            </div>
          </div>
        )}
      </div>

      {!isParsing && (
        <div className="flex items-center gap-4 w-full">
          <div className="flex-1 h-px bg-border" />
          <span className="font-mono text-xs text-muted-foreground">OR</span>
          <div className="flex-1 h-px bg-border" />
        </div>
      )}

      {!isParsing && (
        <button
          data-testid="button-load-sample"
          onClick={handleLoadSample}
          className="w-full flex items-center justify-center gap-2 py-3 px-6 border border-border bg-card text-muted-foreground hover:text-foreground hover:border-primary/50 transition-all duration-200 font-mono text-sm uppercase tracking-widest"
        >
          <FlaskConical className="w-4 h-4" strokeWidth={1.5} />
          Load Sample Ride
        </button>
      )}
    </div>
  );
}
