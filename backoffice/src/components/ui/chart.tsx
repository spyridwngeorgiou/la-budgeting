import { formatCompactNumber } from "@/lib/format";
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
    // ONE cursor for every chart: a hairline at the hovered x (bar charts
    // are drawn as ComposedChart so they get the line too, not a band).
    cursor: { stroke: color.chipBorder, strokeWidth: 1, fill: "none" },
  },
  // ONE legend icon: a short line, dashed for a dashed series.
  legend: { iconType: "plainline" as const, iconSize: 14, wrapperStyle: { fontSize: 12, color: color.text, paddingTop: 4 } },
  // A line series: 2px, no dots except the hovered one.
  line: (index: 0 | 1) => ({
    stroke: chartSeries[index],
    strokeWidth: 2,
    strokeDasharray: DASH[index],
    dot: false,
    activeDot: { r: 4, strokeWidth: 2, stroke: color.canvas, fill: chartSeries[index] },
    // Straight segments between the real points: a smoothed curve invents
    // dips and peaks the data does not have (misleading on money).
    type: "linear" as const,
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

// TWO chart heights for the whole app: 176px on phones, 220px from md up
// (h-chart-sm / h-chart, spacing tokens in globals.css).
export const CHART_HEIGHT_CLASS = "h-chart-sm md:h-chart";

// 12.400 -> «12 κ.», 1.250.000 -> «1,3 εκ.» for axis ticks (the tooltip
// shows the exact amount). Greek units and the true minus (lib/format).
export function compactNumber(v: number): string {
  return formatCompactNumber(v);
}

// The categorical palette of stacked bars (outflows by source, results by
// segment): the brand's own shades only, no new hue, ordered dark / light /
// mid so neighbouring segments separate; a canvas hairline between the
// segments does the rest. At most six series. The negative colour is not
// here: it is kept for «below the threshold».
export const STACK_PALETTE = [color.navy, color.chipBorder, color.accent, color.ink, color.hairline, color.muted] as const;

// The labels of reference lines (the cash buffer, the next deadline) sit
// UNDER the chart as a key, never inside the plot where they would cover
// bars: a short line in the reference's colour and dash, then its words.
// "below" is the dot on the months under the threshold, "band" the tint of
// the safety zone. `as="div"` outside a <figure>.
export type ReferenceKeyKind = "threshold" | "today" | "below" | "band";

export function ReferenceKey({
  items,
  as: Tag = "figcaption",
}: {
  items: { label: string; kind: ReferenceKeyKind }[];
  as?: "figcaption" | "div";
}) {
  if (items.length === 0) return null;
  return (
    <Tag className="flex flex-wrap gap-x-5 gap-y-1 pt-2 text-small text-text">
      {items.map((it) => {
        const ref = it.kind === "today" ? chartTheme.today : chartTheme.threshold;
        return (
          <span key={it.label} className="inline-flex items-center gap-2">
            <svg width="16" height="8" aria-hidden="true" className="shrink-0">
              {it.kind === "below" ? (
                <circle cx="8" cy="4" r="3.5" fill={color.negative} />
              ) : it.kind === "band" ? (
                <rect x="0" y="0" width="16" height="8" fill={color.negativeTint} />
              ) : (
                <line x1="0" y1="4" x2="16" y2="4" stroke={ref.stroke} strokeWidth={1.5} strokeDasharray={ref.strokeDasharray} />
              )}
            </svg>
            {it.label}
          </span>
        );
      })}
    </Tag>
  );
}
