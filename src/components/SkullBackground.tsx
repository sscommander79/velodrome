const SKULLS = [
  { top: '4%',  left: '3%',  size: 80,  opacity: 0.07, rotate: -15 },
  { top: '2%',  left: '78%', size: 120, opacity: 0.05, rotate: 12  },
  { top: '18%', left: '91%', size: 60,  opacity: 0.09, rotate: -8  },
  { top: '35%', left: '1%',  size: 100, opacity: 0.06, rotate: 20  },
  { top: '55%', left: '88%', size: 90,  opacity: 0.07, rotate: -20 },
  { top: '70%', left: '6%',  size: 70,  opacity: 0.05, rotate: 10  },
  { top: '80%', left: '72%', size: 110, opacity: 0.06, rotate: -5  },
  { top: '90%', left: '40%', size: 65,  opacity: 0.04, rotate: 18  },
  { top: '48%', left: '45%', size: 150, opacity: 0.03, rotate: -12 },
  { top: '15%', left: '52%', size: 55,  opacity: 0.06, rotate: 25  },
  { top: '63%', left: '30%', size: 85,  opacity: 0.05, rotate: -18 },
  { top: '28%', left: '20%', size: 45,  opacity: 0.08, rotate: 8   },
];

function MisfitsSkull({ size, opacity, rotate }: { size: number; opacity: number; rotate: number }) {
  return (
    <svg
      viewBox="0 0 200 240"
      width={size}
      height={size * 1.2}
      style={{ opacity, transform: `rotate(${rotate}deg)`, display: 'block' }}
      aria-hidden="true"
    >
      <ellipse cx="100" cy="88" rx="87" ry="88" fill="white" />
      <ellipse cx="64"  cy="76" rx="31" ry="36" fill="black" />
      <ellipse cx="136" cy="76" rx="31" ry="36" fill="black" />
      <ellipse cx="100" cy="122" rx="16" ry="20" fill="black" />
      <path d="M24 158 Q24 145 38 145 L162 145 Q176 145 176 158 L176 210 Q176 224 162 224 L38 224 Q24 224 24 210 Z" fill="white" />
      <rect x="38"  y="165" width="20" height="52" rx="4" fill="black" />
      <rect x="68"  y="162" width="20" height="58" rx="4" fill="black" />
      <rect x="112" y="162" width="20" height="58" rx="4" fill="black" />
      <rect x="142" y="165" width="20" height="52" rx="4" fill="black" />
      <rect x="90"  y="166" width="20" height="30" rx="4" fill="black" />
    </svg>
  );
}

export function SkullBackground() {
  return (
    <div
      className="fixed inset-0 pointer-events-none overflow-hidden"
      style={{ zIndex: 0 }}
      aria-hidden="true"
    >
      {SKULLS.map((s, i) => (
        <div
          key={i}
          className="absolute"
          style={{ top: s.top, left: s.left }}
        >
          <MisfitsSkull size={s.size} opacity={s.opacity} rotate={s.rotate} />
        </div>
      ))}
    </div>
  );
}
