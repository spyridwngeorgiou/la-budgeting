import { chartSeries, color } from "./tokens";

// The recharts theme: spread these props onto recharts elements so every
// chart reads as one system. Lines, not fills; recessive axes and grid;
// a square tooltip on the field colour; text in text tokens, never in the
// series colour. Plain objects (no "use client"), so server and client code
// can both import them; the charts themselves are client components
// (see TrendChart.tsx).
//
//   <CartesianGrid {...chartTheme.grid} />
//   <XAxis dataKey="label" {...chartTheme.xAxis} />
//   <YAxis {...chartTheme.yAxis} tickFormatter={compactEuro} />
//   <Tooltip {...chartTheme.tooltip} />
//   <Line dataKey="cash" {...chartTheme.line(0)} />

const tick = { fontSize: 12, fill: color.muted, fontFamily: "var(--font-sans)" };

// Dash per series index, so the two series differ by more than colour.
const DASH = [undefined, "5 4"] as const;

export const chartTheme = {
  grid: { stroke: color.hairline, vertical: false, strokeDasharray: undefined },
  xAxis: { tick, tickLine: false, axisLine: { stroke: color.hairline }, tickMargin: 8 },
  yAxis: { tick, tickLine: false, axisLine: false, width: 56 },
  tooltip: {
    contentStyle: {
      background: color.field,
      border: `1px solid ${color.hairline}`,
      borderRadius: 0,
      boxShadow: "none",
      fontSize: 13,
      color: color.text,
    },
    labelStyle: { color: color.ink, fontWeight: 500, marginBottom: 4 },
    itemStyle: { color: color.text, padding: 0 },
    cursor: { stroke: color.chipBorder, strokeWidth: 1 },
  },
  legend: { iconType: "plainline" as const, wrapperStyle: { fontSize: 12, color: color.text } },
  // A line series: 2px, no dots except the hovered one.
  line: (index: 0 | 1) => ({
    stroke: chartSeries[index],
    strokeWidth: 2,
    strokeDasharray: DASH[index],
    dot: false,
    activeDot: { r: 4, strokeWidth: 2, stroke: color.canvas, fill: chartSeries[index] },
    type: "monotone" as const,
    isAnimationActive: false,
  }),
  // A bar series (when bars are the right form): thin, flat fill.
  bar: (index: 0 | 1) => ({ fill: chartSeries[index], maxBarSize: 24, isAnimationActive: false }),
  // Reference lines: zero / today as hairlines, a threshold (cash buffer) in
  // the negative colour, dashed.
  zero: { stroke: color.chipBorder, strokeWidth: 1 },
  today: { stroke: color.muted, strokeDasharray: "2 3" },
  threshold: { stroke: color.negative, strokeDasharray: "4 4" },
} as const;

// 12.400 -> «12k», 1.250.000 -> «1,3m» for axis ticks (the tooltip shows
// the exact amount).
export function compactNumber(v: number): string {
  const a = Math.abs(v);
  const sign = v < 0 ? "−" : "";
  if (a >= 1_000_000) return `${sign}${(a / 1_000_000).toLocaleString("el-GR", { maximumFractionDigits: 1 })}m`;
  if (a >= 1000) return `${sign}${Math.round(a / 1000)}k`;
  return `${sign}${a}`;
}
