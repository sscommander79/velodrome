import { useState } from "react";
import { NormalizedRide, MidiConfig, ConversionResult } from "@/lib/types";
import { convertToMidi } from "@/lib/midi/converter";
import { UploadZone } from "@/components/UploadZone";
import { DataPanel } from "@/components/DataPanel";
import { ConfigurationPanel } from "@/components/ConfigurationPanel";
import { ElevationChart } from "@/components/ElevationChart";
import { ResultPanel } from "@/components/ResultPanel";
import { Button } from "@/components/ui/button";
import { SkullBackground } from "@/components/SkullBackground";
import { GuideDialog } from "@/components/GuideDialog";
import { buildSampleRide } from "@/lib/sampleRide";

function SkullIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 115" fill="currentColor" className={className} aria-hidden="true">
      <ellipse cx="50" cy="45" rx="38" ry="40" />
      <rect x="24" y="76" width="15" height="20" rx="2" />
      <rect x="61" y="76" width="15" height="20" rx="2" />
      <rect x="39" y="76" width="22" height="15" rx="2" />
      <ellipse cx="36" cy="41" rx="12" ry="14" fill="black" />
      <ellipse cx="64" cy="41" rx="12" ry="14" fill="black" />
      <ellipse cx="50" cy="59" rx="5" ry="6" fill="black" />
      <rect x="29" y="70" width="7" height="11" rx="1" fill="black" />
      <rect x="46.5" y="70" width="7" height="11" rx="1" fill="black" />
      <rect x="64" y="70" width="7" height="11" rx="1" fill="black" />
    </svg>
  );
}

const CREEPSTER = "'Creepster', cursive";

export function Home() {
  const [ride, setRide] = useState<NormalizedRide | null>(null);
  const [isParsing, setIsParsing] = useState(false);
  const [isConverting, setIsConverting] = useState(false);
  const [conversionProgress, setConversionProgress] = useState(0);
  const [result, setResult] = useState<ConversionResult | null>(null);
  const [config, setConfig] = useState<MidiConfig>({
    key: "C",
    mode: "minor",
    tempoMin: 60,
    tempoMax: 160,
    rhythmicSensitivity: 0.5,
    targetBars: 64,
    stepsPerBar: 16,
  });

  const handleRideParsed = (newRide: NormalizedRide) => {
    setRide(newRide);
    setResult(null);
  };

  const handleLoadSample = () => {
    setRide(buildSampleRide());
    setResult(null);
  };

  const handleGenerate = async () => {
    if (!ride) return;
    setIsConverting(true);
    setConversionProgress(0);

    try {
      const res = await convertToMidi(ride, config, (progress) => {
        setConversionProgress(progress);
      });
      setResult(res);
    } catch (err) {
      console.error(err);
    } finally {
      setIsConverting(false);
      setConversionProgress(1);
    }
  };

  const handleReset = () => {
    setRide(null);
    setResult(null);
    setConversionProgress(0);
  };

  return (
    <div className="min-h-screen w-full bg-background text-foreground flex flex-col items-center relative">
      <SkullBackground />

      <header className="w-full border-b border-border bg-black/90 backdrop-blur px-6 py-3 sticky top-0 z-10 flex justify-between items-center">
        <div className="flex items-center gap-3">
          <SkullIcon className="w-9 h-10 text-primary drop-shadow-[0_0_6px_rgba(170,255,0,0.6)]" />
          <span
            className="text-4xl text-primary leading-none tracking-wider drop-shadow-[0_0_8px_rgba(170,255,0,0.4)]"
            style={{ fontFamily: CREEPSTER }}
          >
            VELODROME
          </span>
        </div>
        <div className="flex items-center gap-3">
          <GuideDialog />
          {ride && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleReset}
              data-testid="button-reset"
              className="font-mono text-xs text-muted-foreground hover:text-primary"
            >
              [ RESET ]
            </Button>
          )}
        </div>
      </header>

      <main className="w-full max-w-5xl px-4 py-8 md:py-12 flex flex-col gap-12 flex-1">

        {!ride ? (
          <section className="flex-1 flex flex-col items-center justify-center min-h-[60vh] gap-8">
            <div className="text-center space-y-5 max-w-lg">
              <h1
                className="text-5xl md:text-6xl text-primary leading-tight drop-shadow-[0_0_12px_rgba(170,255,0,0.3)]"
                style={{ fontFamily: CREEPSTER, letterSpacing: '0.04em' }}
              >
                Turn Telemetry Into Music.
              </h1>
              <p className="text-muted-foreground text-lg">
                Upload your Strava activity. We'll map elevation to pitch,
                speed to tempo, and cadence to rhythm.
              </p>
            </div>
            <UploadZone
              onParsed={handleRideParsed}
              isParsing={isParsing}
              onParsingStart={() => setIsParsing(true)}
              onParsingEnd={() => setIsParsing(false)}
            />
            <button
              onClick={handleLoadSample}
              data-testid="button-load-sample"
              className="font-mono text-xs uppercase tracking-widest text-muted-foreground hover:text-primary transition-colors border-b border-dashed border-muted-foreground/40 hover:border-primary pb-0.5"
            >
              or load a sample ride →
            </button>
          </section>

        ) : !result && !isConverting ? (
          <section className="grid grid-cols-1 lg:grid-cols-12 gap-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="lg:col-span-5 space-y-8">
              <div className="space-y-2">
                <h2
                  className="text-3xl text-primary"
                  style={{ fontFamily: CREEPSTER, letterSpacing: '0.05em' }}
                >
                  Activity Status
                </h2>
                <div className="h-px w-full bg-primary/30" />
              </div>
              <DataPanel ride={ride} />
            </div>

            <div className="lg:col-span-7 space-y-8">
              <div className="space-y-2">
                <h2
                  className="text-3xl text-primary"
                  style={{ fontFamily: CREEPSTER, letterSpacing: '0.05em' }}
                >
                  Synthesizer Config
                </h2>
                <div className="h-px w-full bg-primary/30" />
              </div>
              <ConfigurationPanel
                config={config}
                onChange={(c) => setConfig({ ...config, ...c })}
              />
              <Button
                onClick={handleGenerate}
                data-testid="button-generate"
                className="w-full h-16 tracking-widest uppercase bg-primary text-primary-foreground hover:bg-primary/90 transition-all rounded-none border border-primary/20 shadow-[0_0_24px_rgba(170,255,0,0.2)]"
                style={{ fontFamily: CREEPSTER, fontSize: '1.5rem' }}
              >
                Generate MIDI
              </Button>
            </div>
          </section>

        ) : (
          <section className="flex flex-col gap-12 w-full animate-in fade-in duration-500">
            <div className="space-y-2">
              <div className="flex justify-between items-end">
                <h2
                  className="text-3xl text-primary"
                  style={{ fontFamily: CREEPSTER, letterSpacing: '0.05em' }}
                >
                  Sequence Profile
                </h2>
                <div className="font-mono text-sm text-primary">
                  {(conversionProgress * 100).toFixed(0).padStart(3, '0')}% COMPLETED
                </div>
              </div>
              <div className="h-px w-full bg-primary/30" />
            </div>

            <div className="w-full h-64 md:h-80 bg-card border border-border relative overflow-hidden">
              <ElevationChart
                points={ride.points.map(p => p.altitude)}
                progress={conversionProgress}
              />

              {isConverting && (
                <div className="absolute inset-0 flex items-center justify-center backdrop-blur-[2px] bg-black/30">
                  <div
                    className="text-3xl animate-pulse text-primary tracking-widest drop-shadow-[0_0_10px_rgba(170,255,0,0.6)]"
                    style={{ fontFamily: CREEPSTER }}
                  >
                    PROCESSING TELEMETRY...
                  </div>
                </div>
              )}
            </div>

            {result && (
              <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 delay-300 fill-mode-both">
                <ResultPanel result={result} ride={ride} config={config} onReset={handleReset} />
              </div>
            )}
          </section>
        )}
      </main>

      <footer className="w-full border-t border-border py-6 text-center text-xs font-mono text-muted-foreground mt-auto">
        SYSTEM: VELODROME // CORE: TONE.JS // DATA: GPS/FIT/TCX
      </footer>
    </div>
  );
}
