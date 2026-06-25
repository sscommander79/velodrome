import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { NormalizedRide, MidiConfig } from "@/lib/types";
import { requestMidiAccess, getOutputDevices, MidiDevice, isBrowserSupported } from "@/lib/midi/webmidi";
import { segmentRide, StepData } from "@/lib/midi/segmenter";
import { sendPatternSysEx, playStepsRealtime, PlaybackHandle } from "@/lib/midi/digitakt";

const STEP_OPTIONS = [16, 32, 48, 64, 128] as const;
type StepCount = typeof STEP_OPTIONS[number];

const CREEPSTER = "'Creepster', cursive";

interface DigitaktPanelProps {
  ride: NormalizedRide;
  config: MidiConfig;
}

type Mode = "sysex" | "realtime";
type Status = "idle" | "connecting" | "ready" | "sending" | "playing" | "done" | "error";

export function DigitaktPanel({ ride, config }: DigitaktPanelProps) {
  const [midiAccess, setMidiAccess] = useState<MIDIAccess | null>(null);
  const [devices, setDevices] = useState<MidiDevice[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>("");
  const [stepCount, setStepCount] = useState<StepCount>(32);
  const [track, setTrack] = useState(1);
  const [channel, setChannel] = useState(1);
  const [deviceId, setDeviceId] = useState(0x12); // DT2 community-reported ID
  const [bpm, setBpm] = useState(120);
  const [mode, setMode] = useState<Mode>("sysex");
  const [status, setStatus] = useState<Status>("idle");
  const [statusMsg, setStatusMsg] = useState("");
  const [activeStep, setActiveStep] = useState<number | null>(null);
  const [steps, setSteps] = useState<StepData[]>([]);
  const [playHandle, setPlayHandle] = useState<PlaybackHandle | null>(null);

  const browserOk = isBrowserSupported();

  const refreshDevices = useCallback((access: MIDIAccess) => {
    const devs = getOutputDevices(access);
    setDevices(devs);
    if (devs.length > 0 && !selectedDeviceId) {
      setSelectedDeviceId(devs[0].id);
    }
  }, [selectedDeviceId]);

  const handleConnect = async () => {
    setStatus("connecting");
    setStatusMsg("Requesting MIDI access…");
    const access = await requestMidiAccess();
    if (!access) {
      setStatus("error");
      setStatusMsg("MIDI access denied. Use Chrome or Edge, and allow MIDI + SysEx when prompted.");
      return;
    }
    setMidiAccess(access);
    refreshDevices(access);
    access.onstatechange = () => refreshDevices(access);
    setStatus("ready");
    setStatusMsg(`${getOutputDevices(access).length} device(s) found.`);
  };

  useEffect(() => {
    const s = segmentRide(ride, stepCount, config);
    setSteps(s);
  }, [ride, stepCount, config]);

  const selectedOutput = devices.find(d => d.id === selectedDeviceId)?.output ?? null;

  const handleSend = async () => {
    if (!selectedOutput) return;
    if (mode === "sysex") {
      setStatus("sending");
      setStatusMsg("Sending SysEx pattern to Digitakt 2…");
      try {
        await sendPatternSysEx(selectedOutput, deviceId, track - 1, steps);
        setStatus("done");
        setStatusMsg(`Pattern sent to track ${track}. Check the DT2 pattern slot.`);
      } catch (e) {
        setStatus("error");
        setStatusMsg(`SysEx error: ${e}`);
      }
    } else {
      if (playHandle) {
        playHandle.stop();
        setPlayHandle(null);
        setStatus("ready");
        setStatusMsg("Playback stopped.");
        setActiveStep(null);
        return;
      }
      setStatus("playing");
      setStatusMsg(`Live playback at ${bpm} BPM on ch ${channel}. Put DT2 in Live Recording mode.`);
      setActiveStep(0);
      const handle = playStepsRealtime(
        selectedOutput,
        channel,
        steps,
        bpm,
        (i) => setActiveStep(i),
      );
      setPlayHandle(handle);
      // Auto-clear when done
      const durationMs = steps.length * (60_000 / bpm) / 4;
      setTimeout(() => {
        setPlayHandle(null);
        setStatus("done");
        setStatusMsg("Playback complete. Pattern captured on DT2.");
        setActiveStep(null);
      }, durationMs + 200);
    }
  };

  const activeSteps = steps.filter(s => s.active).length;

  return (
    <div className="border border-primary/20 bg-card p-6 md:p-8 space-y-6">
      <div className="space-y-1">
        <h3
          className="text-2xl text-primary"
          style={{ fontFamily: CREEPSTER, letterSpacing: '0.05em' }}
        >
          Send to Digitakt 2
        </h3>
        <div className="h-px w-full bg-primary/20" />
      </div>

      {!browserOk && (
        <div className="bg-destructive/10 border border-destructive/40 p-4 text-sm font-mono text-destructive">
          Web MIDI requires Chrome or Edge. Firefox and Safari are not supported.
        </div>
      )}

      {/* Step visualizer */}
      <div className="space-y-2">
        <div className="flex justify-between items-center">
          <Label className="uppercase tracking-widest text-xs text-muted-foreground font-mono">
            Step Pattern Preview — {activeSteps}/{stepCount} active trigs
          </Label>
          <span className="font-mono text-xs text-primary">{stepCount} STEPS</span>
        </div>
        <div className="flex flex-wrap gap-[3px]">
          {steps.map((step, i) => (
            <div
              key={i}
              title={`Step ${i + 1}: note ${step.note}, vel ${step.velocity}`}
              className={[
                "h-4 transition-all duration-75",
                i === activeStep ? "bg-white scale-y-150" : step.active ? "bg-primary" : "bg-border",
              ].join(" ")}
              style={{ width: `calc(${100 / Math.max(stepCount, 1)}% - 3px)` }}
            />
          ))}
        </div>
        <div className="flex gap-2 flex-wrap">
          {STEP_OPTIONS.map(n => (
            <button
              key={n}
              onClick={() => setStepCount(n)}
              className={[
                "px-3 py-1 text-sm font-mono border transition-colors",
                stepCount === n
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-background text-muted-foreground border-border hover:border-primary/50",
              ].join(" ")}
            >
              {n}
            </button>
          ))}
        </div>
      </div>

      {/* Mode selector */}
      <div className="grid grid-cols-2 gap-3">
        <button
          onClick={() => setMode("sysex")}
          className={[
            "p-4 border text-left transition-colors space-y-1",
            mode === "sysex" ? "border-primary bg-primary/10" : "border-border hover:border-primary/40",
          ].join(" ")}
        >
          <div className="font-mono text-xs uppercase tracking-widest text-primary">Write via SysEx</div>
          <div className="text-xs text-muted-foreground">Writes pattern directly to DT2 sequencer. Device must be idle.</div>
        </button>
        <button
          onClick={() => setMode("realtime")}
          className={[
            "p-4 border text-left transition-colors space-y-1",
            mode === "realtime" ? "border-primary bg-primary/10" : "border-border hover:border-primary/40",
          ].join(" ")}
        >
          <div className="font-mono text-xs uppercase tracking-widest text-primary">Live Playback</div>
          <div className="text-xs text-muted-foreground">Plays notes in real time. DT2 must be in Live Recording mode to capture.</div>
        </button>
      </div>

      {/* Config grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="space-y-2">
          <Label className="uppercase tracking-widest text-xs text-muted-foreground font-mono">DT2 Track</Label>
          <Select value={String(track)} onValueChange={v => setTrack(Number(v))}>
            <SelectTrigger className="font-mono bg-background border-border rounded-none h-10 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="rounded-none bg-card border-border">
              {Array.from({ length: 16 }, (_, i) => (
                <SelectItem key={i + 1} value={String(i + 1)} className="font-mono">Track {i + 1}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label className="uppercase tracking-widest text-xs text-muted-foreground font-mono">MIDI Channel</Label>
          <Select value={String(channel)} onValueChange={v => setChannel(Number(v))}>
            <SelectTrigger className="font-mono bg-background border-border rounded-none h-10 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="rounded-none bg-card border-border">
              {Array.from({ length: 16 }, (_, i) => (
                <SelectItem key={i + 1} value={String(i + 1)} className="font-mono">Ch {i + 1}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {mode === "realtime" && (
          <div className="space-y-2">
            <Label className="uppercase tracking-widest text-xs text-muted-foreground font-mono">BPM</Label>
            <div className="flex">
              <input
                type="number"
                min={40} max={240} value={bpm}
                onChange={e => setBpm(Number(e.target.value))}
                className="w-full bg-background border border-border font-mono text-sm px-3 h-10 text-foreground focus:outline-none focus:border-primary"
              />
            </div>
          </div>
        )}

        {mode === "sysex" && (
          <div className="space-y-2">
            <Label className="uppercase tracking-widest text-xs text-muted-foreground font-mono">Device ID (hex)</Label>
            <div className="flex">
              <input
                type="number"
                min={0} max={127} value={deviceId}
                onChange={e => setDeviceId(Number(e.target.value))}
                className="w-full bg-background border border-border font-mono text-sm px-3 h-10 text-foreground focus:outline-none focus:border-primary"
              />
            </div>
            <p className="text-xs text-muted-foreground font-mono">DT2 = 0x12 (18)</p>
          </div>
        )}
      </div>

      {/* Device connection */}
      <div className="space-y-3 pt-2 border-t border-border/50">
        {status === "idle" || status === "error" ? (
          <Button
            onClick={handleConnect}
            disabled={!browserOk}
            className="w-full h-12 rounded-none bg-secondary border border-border text-foreground hover:border-primary/50 font-mono text-sm tracking-widest uppercase"
          >
            Connect MIDI Device
          </Button>
        ) : (
          <div className="space-y-3">
            {devices.length > 0 && (
              <Select value={selectedDeviceId} onValueChange={setSelectedDeviceId}>
                <SelectTrigger className="font-mono bg-background border-border rounded-none h-10 text-sm w-full">
                  <SelectValue placeholder="Select output device…" />
                </SelectTrigger>
                <SelectContent className="rounded-none bg-card border-border">
                  {devices.map(d => (
                    <SelectItem key={d.id} value={d.id} className="font-mono">{d.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Button
              onClick={handleSend}
              disabled={!selectedOutput || status === "sending"}
              className={[
                "w-full h-14 rounded-none font-bold tracking-widest uppercase border",
                status === "playing"
                  ? "bg-destructive text-destructive-foreground border-destructive hover:bg-destructive/90"
                  : "bg-primary text-primary-foreground border-primary/20 hover:bg-primary/90 shadow-[0_0_20px_rgba(170,255,0,0.15)]",
              ].join(" ")}
              style={{ fontFamily: CREEPSTER, fontSize: '1.3rem' }}
            >
              {status === "playing"
                ? "STOP PLAYBACK"
                : status === "sending"
                ? "SENDING…"
                : mode === "sysex"
                ? `Write to DT2 Track ${track}`
                : "Start Live Playback"}
            </Button>
          </div>
        )}

        {statusMsg && (
          <div className={[
            "font-mono text-xs p-3 border",
            status === "error"
              ? "border-destructive/40 text-destructive bg-destructive/10"
              : status === "done"
              ? "border-primary/30 text-primary bg-primary/10"
              : "border-border/50 text-muted-foreground",
          ].join(" ")}>
            {statusMsg}
          </div>
        )}

        {mode === "sysex" && status !== "idle" && (
          <p className="text-xs text-muted-foreground font-mono leading-relaxed">
            SysEx format: Elektron 7-bit packed, device ID 0x{deviceId.toString(16).toUpperCase().padStart(2, '0')}, command 0x68.
            Based on community-documented Elektron protocol (OS 1.15A). Verify with your firmware before use.
          </p>
        )}
      </div>
    </div>
  );
}
