import { MidiConfig, MusicalKey, MusicalMode } from "@/lib/types";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface ConfigurationPanelProps {
  config: MidiConfig;
  onChange: (config: Partial<MidiConfig>) => void;
}

const KEYS: MusicalKey[] = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];

const MODE_DESCRIPTIONS: Record<MusicalMode, string> = {
  major: "Bright, triumphant, resolved.",
  minor: "Dark, tense, driving.",
  pentatonic: "Spacious, floating, cinematic.",
};

export function ConfigurationPanel({ config, onChange }: ConfigurationPanelProps) {
  return (
    <div className="space-y-8 bg-card border border-border/50 p-6 md:p-8">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        {/* Key & Mode */}
        <div className="space-y-4">
          <Label className="uppercase tracking-widest text-xs text-muted-foreground font-mono">Tonal Center</Label>
          <Select value={config.key} onValueChange={(val: MusicalKey) => onChange({ key: val })}>
            <SelectTrigger className="font-mono bg-background border-border/50 rounded-none h-12">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="rounded-none bg-card border-border">
              {KEYS.map(k => <SelectItem key={k} value={k} className="font-mono">{k}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-4">
          <Label className="uppercase tracking-widest text-xs text-muted-foreground font-mono">Scale Mode</Label>
          <Select value={config.mode} onValueChange={(val: MusicalMode) => onChange({ mode: val })}>
            <SelectTrigger className="font-mono bg-background border-border/50 rounded-none h-12">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="rounded-none bg-card border-border">
              <SelectItem value="major" className="font-mono">Major</SelectItem>
              <SelectItem value="minor" className="font-mono">Minor</SelectItem>
              <SelectItem value="pentatonic" className="font-mono">Pentatonic</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground italic">{MODE_DESCRIPTIONS[config.mode]}</p>
        </div>
      </div>

      {/* Tempo */}
      <div className="space-y-6 pt-4 border-t border-border/50">
        <div className="flex justify-between items-baseline">
          <Label className="uppercase tracking-widest text-xs text-muted-foreground font-mono">Tempo Range (BPM)</Label>
          <div className="font-mono text-sm text-primary">
            {config.tempoMin} - {config.tempoMax}
          </div>
        </div>
        
        <div className="grid grid-cols-2 gap-8">
          <div className="space-y-3">
            <Label className="text-xs text-muted-foreground">Min (Climbs)</Label>
            <Slider 
              min={40} max={120} step={1} 
              value={[config.tempoMin]}
              onValueChange={([val]) => onChange({ tempoMin: Math.min(val, config.tempoMax - 10) })}
              className="[&_[role=slider]]:border-primary [&_[role=slider]]:bg-background [&_[role=slider]]:rounded-none"
            />
          </div>
          <div className="space-y-3">
            <Label className="text-xs text-muted-foreground">Max (Descents)</Label>
            <Slider 
              min={80} max={200} step={1} 
              value={[config.tempoMax]}
              onValueChange={([val]) => onChange({ tempoMax: Math.max(val, config.tempoMin + 10) })}
              className="[&_[role=slider]]:border-primary [&_[role=slider]]:bg-background [&_[role=slider]]:rounded-none"
            />
          </div>
        </div>
      </div>

      {/* Sensitivity */}
      <div className="space-y-6 pt-4 border-t border-border/50">
        <div className="flex justify-between items-baseline">
          <Label className="uppercase tracking-widest text-xs text-muted-foreground font-mono">Rhythmic Variance</Label>
          <div className="font-mono text-sm text-primary">
            {Math.round(config.rhythmicSensitivity * 100)}%
          </div>
        </div>
        <Slider 
          min={0} max={1} step={0.05} 
          value={[config.rhythmicSensitivity]}
          onValueChange={([val]) => onChange({ rhythmicSensitivity: val })}
          className="[&_[role=slider]]:border-primary [&_[role=slider]]:bg-background [&_[role=slider]]:rounded-none"
        />
        <p className="text-xs text-muted-foreground">
          Higher sensitivity forces aggressive subdivision changes when cadence shifts. Lower sensitivity creates a steadier groove.
        </p>
      </div>
    </div>
  );
}
