import { useMemo } from "react";

interface ElevationChartProps {
  points: number[];
  progress: number; // 0 to 1
}

export function ElevationChart({ points, progress }: ElevationChartProps) {
  const { pathData, minAlt, maxAlt } = useMemo(() => {
    if (points.length === 0) return { pathData: "", minAlt: 0, maxAlt: 0 };
    
    const minAlt = Math.min(...points);
    const maxAlt = Math.max(...points);
    const range = maxAlt - minAlt || 1; // avoid div by zero
    
    // SVG viewbox will be 1000 x 100
    // Y coords: 0 is top, 100 is bottom
    // so normalize to 0..1, invert, scale to 100
    
    let path = `M 0,100 `;
    
    for (let i = 0; i < points.length; i++) {
      const x = (i / (points.length - 1)) * 1000;
      const normalizedY = (points[i] - minAlt) / range;
      const y = 100 - (normalizedY * 90); // keep a bit of padding at top
      path += `L ${x.toFixed(1)},${y.toFixed(1)} `;
    }
    
    path += `L 1000,100 Z`;
    
    return { pathData: path, minAlt, maxAlt };
  }, [points]);

  if (!pathData) return null;

  return (
    <div className="w-full h-full relative" data-testid="elevation-chart">
      {/* Background trace (unfilled) */}
      <svg 
        viewBox="0 0 1000 100" 
        preserveAspectRatio="none"
        className="absolute inset-0 w-full h-full opacity-20"
      >
        <path d={pathData} fill="currentColor" className="text-muted-foreground" />
      </svg>
      
      {/* Active trace (filled via clip-path) */}
      <div 
        className="absolute inset-0 w-full h-full bg-gradient-to-b from-primary/80 to-primary/5 transition-all duration-75 ease-linear"
        style={{ clipPath: `polygon(0 0, ${progress * 100}% 0, ${progress * 100}% 100%, 0 100%)` }}
      >
        <svg 
          viewBox="0 0 1000 100" 
          preserveAspectRatio="none"
          className="absolute inset-0 w-full h-full"
        >
          <path d={pathData} fill="currentColor" className="text-primary" />
        </svg>
      </div>

      {/* Playhead line */}
      {progress > 0 && progress < 1 && (
        <div 
          className="absolute top-0 bottom-0 w-px bg-primary shadow-[0_0_8px_rgba(198,241,53,0.8)] transition-all duration-75 ease-linear z-10"
          style={{ left: `${progress * 100}%` }}
        />
      )}

      {/* Axis labels */}
      <div className="absolute left-2 top-2 font-mono text-[10px] text-muted-foreground z-20">
        {Math.round(maxAlt)}m
      </div>
      <div className="absolute left-2 bottom-2 font-mono text-[10px] text-muted-foreground z-20">
        {Math.round(minAlt)}m
      </div>
    </div>
  );
}
