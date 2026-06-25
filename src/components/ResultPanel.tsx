import { ConversionResult, NormalizedRide, MidiConfig } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Download, RefreshCw } from "lucide-react";
import { DigitaktPanel } from "@/components/DigitaktPanel";

interface ResultPanelProps {
  result: ConversionResult;
  ride: NormalizedRide;
  config: MidiConfig;
  onReset: () => void;
}

export function ResultPanel({ result, ride, config, onReset }: ResultPanelProps) {
  const handleDownload = () => {
    const blob = new Blob([result.midiBytes.buffer as ArrayBuffer], { type: "audio/midi" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const name = ride.name ? ride.name.replace(/[^a-z0-9]/gi, '_').toLowerCase() : 'ride';
    a.download = `velodrome_${name}.mid`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

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
      </div>

      {/* Digitakt 2 panel */}
      <DigitaktPanel ride={ride} config={config} />
    </div>
  );
}
