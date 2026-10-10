import { cn } from "./cn";

// A tiny trend line, drawn by hand (no chart library, renders on the
// server). A line, not a fill; a dot on the last value. An optional zero
// baseline as a hairline when the series crosses it.
export function Sparkline({
  values,
  width = 96,
  height = 28,
  label,
  onPanel = false,
  className = "",
}: {
  values: number[];
  width?: number;
  height?: number;
  // Accessible description («Ταμείο, τελευταίοι 12 μήνες»).
  label: string;
  onPanel?: boolean;
  className?: string;
}) {
  if (values.length === 0) return null;
  const pad = 3;
  const pts = values.length === 1 ? [values[0], values[0]] : values;
  const min = Math.min(...pts);
  const max = Math.max(...pts);
  const span = max - min || 1;
  const x = (i: number) => pad + (i * (width - 2 * pad)) / Math.max(pts.length - 1, 1);
  const y = (v: number) => pad + (1 - (v - min) / span) * (height - 2 * pad);
  const d = pts.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const crossesZero = min < 0 && max > 0;
  const last = pts.length - 1;

  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      className={cn(onPanel ? "text-panel-ink" : "text-navy", className)}
    >
      {crossesZero && (
        <line
          x1={pad}
          x2={width - pad}
          y1={y(0)}
          y2={y(0)}
          stroke="currentColor"
          strokeOpacity={0.35}
          strokeWidth={1}
          strokeDasharray="2 2"
        />
      )}
      <path d={d} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(last)} cy={y(pts[last])} r={2.25} fill="currentColor" />
    </svg>
  );
}
