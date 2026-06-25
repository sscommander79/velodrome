import { NormalizedRide, DataStatus } from "@/lib/types";

interface DataPanelProps {
  ride: NormalizedRide;
}

function StatusIndicator({ status }: { status: DataStatus }) {
  const getStatusStyle = () => {
    switch (status) {
      case "recorded": return "text-primary border-primary/50 bg-primary/10";
      case "estimated": return "text-amber-500 border-amber-500/50 bg-amber-500/10";
      case "unavailable": return "text-muted-foreground border-border bg-muted/20";
    }
  };

  return (
    <div className={`text-xs font-mono px-2 py-0.5 border uppercase ${getStatusStyle()}`}>
      {status}
    </div>
  );
}

function StatCard({ label, value, unit }: { label: string, value: string | number, unit: string }) {
  return (
    <div className="bg-card border border-border/50 p-4 flex flex-col justify-between">
      <span className="text-xs text-muted-foreground uppercase tracking-wider">{label}</span>
      <div className="mt-2 font-mono flex items-baseline gap-1">
        <span className="text-2xl text-foreground">{value}</span>
        <span className="text-sm text-muted-foreground">{unit}</span>
      </div>
    </div>
  );
}

export function DataPanel({ ride }: DataPanelProps) {
  const { availability } = ride;
  
  const formatTime = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4">
        <StatCard label="Distance" value={(ride.distanceMeters / 1000).toFixed(1)} unit="km" />
        <StatCard label="Duration" value={formatTime(ride.durationSeconds)} unit="" />
        <StatCard label="Elevation" value={Math.round(ride.elevationGain)} unit="m" />
        <StatCard label="Points" value={ride.points.length} unit="sec" />
      </div>

      <div className="bg-card border border-border/50">
        <div className="px-4 py-3 border-b border-border/50 bg-muted/30">
          <h3 className="text-sm uppercase tracking-widest text-muted-foreground font-mono">Sensors</h3>
        </div>
        <div className="p-4 space-y-3">
          <div className="flex justify-between items-center">
            <span className="font-medium text-sm">Elevation</span>
            <StatusIndicator status={availability.altitude} />
          </div>
          <div className="flex justify-between items-center">
            <span className="font-medium text-sm">Speed</span>
            <StatusIndicator status={availability.speed} />
          </div>
          <div className="flex justify-between items-center">
            <span className="font-medium text-sm">Cadence</span>
            <StatusIndicator status={availability.cadence} />
          </div>
          <div className="flex justify-between items-center">
            <span className="font-medium text-sm">Heart Rate</span>
            <StatusIndicator status={availability.heartRate} />
          </div>
          <div className="flex justify-between items-center">
            <span className="font-medium text-sm">Power</span>
            <StatusIndicator status={availability.power} />
          </div>
        </div>
      </div>
    </div>
  );
}
