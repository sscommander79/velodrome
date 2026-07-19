import { ConversionResult, NormalizedRide, MidiConfig } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Download, RefreshCw } from "lucide-react";
import { DigitaktPanel } from "@/components/DigitaktPanel";
import { mergeToSingleTrack, splitTracks } from "@/lib/midi/export";
import { useMemo } from "react";

interface ResultPanelProps {
  result: ConversionResult;
  ride: NormalizedRide;
  config: MidiConfig;
  onReset: () => void;
}

export function ResultPanel({ result, ride, config, onReset }: ResultPanelProps) {
  const safeRideName = ride.name ? ride.name.replace(/[^a-z0-9]/gi, '_').toLowerCase() : 'ride';

  const downloadMidi = (bytes: Uint8Array, suffix: string) => {
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const blob = new Blob([buffer], { type: "audio/midi" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `velodrome_${safeRideName}${suffix}.mid`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleDownload = () => {
    downloadMidi(result.midiBytes, '');
  };

  const secondaryDownloads = useMemo(() => {
    const trackDownloads = splitTracks(result.midiBytes);
    const melodyDownload = trackDownloads.find((track) => track.name.toLowerCase().includes('melody'));
    const harmonyDownload = trackDownloads.find((track) => track.name.toLowerCase().includes('harmony'));
    const rhythmDownload = trackDownloads.find((track) => track.name.toLowerCase().includes('rhythm'));

    return [
      melodyDownload && { label: 'Melody only', suffix: '_melody', bytes: melodyDownload.bytes },
      harmonyDownload && { label: 'Harmony only', suffix: '_harmony', bytes: harmonyDownload.bytes },
      rhythmDownload && { label: 'Rhythm only', suffix: '_rhythm', bytes: rhythmDownload.bytes },
      { label: 'Merged (synth+drums)', suffix: '_merged', bytes: mergeToSingleTrack(result.midiBytes) },
    ].filter((download): download is { label: string; suffix: string; bytes: Uint8Array } => Boolean(download));
  }, [result.midiBytes]);

  const formatMinSec = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <div className="space-y-6">
      {/* Stats + download row */}
      <div className="bg-card border border-primary/30 p-6 md:p-8 flex flex-col md:flex-row gap-8 items-center justify-between shadow-[0_0_30px_rgba(170,255,0,0.05)]">
        <div className="flex-1 grid grid-cols-3 gap-6 w-full">
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground uppercase tracking-widest">Notes Gen</div>
            <div className="font-mono text-2xl text-foreground">{result.noteCount.toLocaleString()}</div>
          </div>
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground uppercase tracking-widest">Duration</div>
            <div className="font-mono text-2xl text-foreground">{formatMinSec(result.durationSeconds)}</div>
          </div>
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground uppercase tracking-widest">BPM Range</div>
            <div className="font-mono text-2xl text-foreground">{result.bpmRange[0]} - {result.bpmRange[1]}</div>
          </div>
        </div>

        <div className="flex flex-col gap-4 w-full md:w-auto">
          <div className="flex gap-4 w-full md:w-auto">
            <Button
              variant="outline"
              onClick={onReset}
              className="flex-1 md:flex-none h-14 px-6 rounded-none border-border hover:bg-secondary font-mono tracking-widest text-xs uppercase"
            >
              <RefreshCw className="w-4 h-4 mr-2" />
              Discard
            </Button>
            <Button
              onClick={handleDownload}
              data-testid="button-download"
              className="flex-1 md:flex-none h-14 px-8 rounded-none bg-primary text-primary-foreground hover:bg-primary/90 font-bold tracking-widest uppercase shadow-[0_0_15px_rgba(170,255,0,0.2)]"
            >
              <Download className="w-5 h-5 mr-2" />
              Export MIDI
            </Button>
          </div>
          <div className="grid grid-cols-2 gap-3 w-full md:w-auto">
            {secondaryDownloads.map((download) => (
              <Button
                key={download.suffix}
                variant="outline"
                onClick={() => downloadMidi(download.bytes, download.suffix)}
                className="h-10 px-4 rounded-none border-border hover:bg-secondary font-mono tracking-widest text-xs uppercase"
              >
                <Download className="w-4 h-4 mr-2" />
                {download.label}
              </Button>
            ))}
          </div>
        </div>
      </div>

      {/* Digitakt 2 panel */}
      <DigitaktPanel ride={ride} config={config} />
    </div>
  );
}
