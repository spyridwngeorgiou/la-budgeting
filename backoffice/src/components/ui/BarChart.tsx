"use client";

import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatMoney } from "@/lib/format";
import { cn } from "./cn";
import { CHART_HEIGHT_CLASS, ReferenceKey, STACK_PALETTE, chartTheme, compactNumber } from "./chart";
import { alignedDomains, axisExtent, num } from "./chartScale";
import { color } from "./tokens";

// Bars (and an optional line or two) on the chart theme, for the report
// tabs: in/out per month, revenue/cost with the result, a signed VAT
// position, a composition in horizontal rows. Props are plain data only, so
// a server component can render it directly; every value is money
// (formatted here). Imported directly from "@/components/ui/BarChart" so
// recharts never rides in through the barrel.
//
// At most three colours: navy, the accent and (for what is owed / lost)
// the negative. A comparison line is the accent, thin and dashed. Two more
// modes:
//   - `stacked`: every bar series in one column, coloured from the fixed
//     brand palette (STACK_PALETTE, ≤6 series) -- outflows by source;
//   - a series with `axis: "right"` gets its OWN scale on the right, with
//     the zero lines of both axes aligned -- signed monthly bars with a
//     cumulative line. Never put monthly flows and a million-scale balance
//     on one axis: give the balance the right axis, or its own chart.

export type BarTone = "navy" | "accent" | "negative";

const TONE: Record<BarTone, string> = {
  navy: color.navy,
  accent: color.accent,
  negative: color.negative,
};

export interface BarSeries {
  key: string;
  name: string;
  // "bar" (default) or "line" -- always money.
  kind?: "bar" | "line";
  tone?: BarTone;
  // A line drawn thin and dashed, for a comparison (last year).
  faint?: boolean;
  // Bars with the same stack id share one column (a signed position).
  stack?: string;
  // The value axis: "left" (default) or its own scale on the right (columns
  // layout only), e.g. the cumulative result next to the monthly bars.
  axis?: "left" | "right";
  // A bar coloured by its sign: `tone` (navy) when ≥ 0, `negativeTone`
  // (default the accent) when < 0.
  signed?: boolean;
  negativeTone?: BarTone;
}

export type BarDatum = Record<string, string | number | null>;

const FAINT_DASH = "4 3";
const CATEGORY_WIDTH = 132;
const STACK_ID = "stack";

// A category label on the left of a horizontal bar: cut to the column's
// width with «…» (the full name in the tooltip and the <title>), so long
// names never run into each other or into the bars.
function CategoryTick({ x, y, payload }: { x?: number; y?: number; payload?: { value: string } }) {
  const full = String(payload?.value ?? "");
  // ~7px per character at 12px Inter.
  const max = Math.floor((CATEGORY_WIDTH - 12) / 7);
  const text = full.length > max ? `${full.slice(0, max - 1)}…` : full;
  return (
    <text x={x} y={y} dy={4} textAnchor="end" fontSize={12} fill={color.muted} fontFamily="var(--font-sans)">
      <title>{full}</title>
      {text}
    </text>
  );
}

export function BarChart({
  data,
  xKey,
  series,
  label,
  layout = "columns",
  toneKey,
  legend,
  threshold,
  marker,
  stacked = false,
  className,
}: {
  data: BarDatum[];
  xKey: string;
  series: BarSeries[];
  // Accessible name of the chart.
  label: string;
  // "rows": horizontal bars, one per datum, the category on the left.
  layout?: "columns" | "rows";
  // A datum field holding a BarTone: colours each bar of a single bar series.
  toneKey?: string;
  // Legend entries when colour is per datum (toneKey) rather than per series.
  legend?: { name: string; tone: BarTone }[];
  threshold?: { value: number; label: string };
  // A vertical marker at one x value (the next deadline, today).
  marker?: { x: string; label?: string };
  // Every bar series in one column, coloured from STACK_PALETTE (≤6).
  stacked?: boolean;
  className?: string;
}) {
  const rows = layout === "rows";
  // Rows grow with the data; columns take one of the two chart heights.
  const style = rows ? { height: Math.max(120, data.length * 30 + 40) } : undefined;
  const bars = series.filter((s) => s.kind !== "line");
  const toneOf = (s: BarSeries, i: number) => {
    if (s.faint) return color.accent;
    if (s.tone) return TONE[s.tone];
    if (stacked && s.kind !== "line") return STACK_PALETTE[bars.indexOf(s) % STACK_PALETTE.length];
    return i === 0 ? TONE.navy : TONE.accent;
  };
  const hasRight = !rows && series.some((s) => s.axis === "right");
  const domains = hasRight
    ? alignedDomains(
        axisExtent(data, series.filter((s) => s.axis !== "right"), stacked ? STACK_ID : undefined),
        axisExtent(data, series.filter((s) => s.axis === "right"), stacked ? STACK_ID : undefined),
      )
    : null;
  // One legend icon (the theme's line). recharts draws a "plainline" icon
  // from payload.strokeDasharray and throws in the browser when payload is
  // missing, so every entry carries one.
  const legendPayload = legend
    ? legend.map((l) => ({ value: l.name, type: "plainline" as const, color: TONE[l.tone], id: l.name, payload: { strokeDasharray: "0" } }))
    : series.map((s, i) => ({
        value: s.name,
        type: "plainline" as const,
        color: toneOf(s, i),
        id: s.key,
        payload: { strokeDasharray: s.faint ? FAINT_DASH : "0" },
      }));
  const showLegend = legend ? legend.length > 1 : series.length > 1;
  const keyItems = [
    ...(threshold ? [{ label: threshold.label, kind: "threshold" as const }] : []),
    ...(marker?.label ? [{ label: marker.label, kind: "today" as const }] : []),
  ];

  return (
    <figure aria-label={label} className={cn("w-full min-w-0", className)}>
      <div className={rows ? undefined : CHART_HEIGHT_CLASS} style={style}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={data}
            layout={rows ? "vertical" : "horizontal"}
            margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
            barGap={2}
            stackOffset="sign"
          >
            <CartesianGrid {...chartTheme.grid} vertical={rows} horizontal={!rows} />
            {/* recharts reads its axes as direct children: no fragments */}
            {rows ? (
              <XAxis type="number" {...chartTheme.xAxis} tickFormatter={compactNumber} />
            ) : (
              <XAxis dataKey={xKey} {...chartTheme.xAxis} />
            )}
            {rows ? (
              <YAxis yAxisId="left" type="category" dataKey={xKey} {...chartTheme.yAxis} width={CATEGORY_WIDTH} interval={0} tick={<CategoryTick />} />
            ) : (
              <YAxis yAxisId="left" {...chartTheme.yAxis} tickFormatter={compactNumber} domain={domains ? domains[0] : undefined} />
            )}
            {domains && (
              <YAxis yAxisId="right" orientation="right" {...chartTheme.yAxis} tickFormatter={compactNumber} domain={domains[1]} />
            )}
            <Tooltip {...chartTheme.tooltip} formatter={(value: number, name: string) => [formatMoney(value), name]} />
            {showLegend && <Legend {...chartTheme.legend} payload={legendPayload} />}
            <ReferenceLine yAxisId="left" {...(rows ? { x: 0 } : { y: 0 })} {...chartTheme.zero} />
            {threshold && <ReferenceLine yAxisId="left" y={threshold.value} {...chartTheme.threshold} />}
            {marker && <ReferenceLine yAxisId="left" x={marker.x} {...chartTheme.today} />}
            {series.map((s, i) => {
              const fill = toneOf(s, i);
              const axis = hasRight && s.axis === "right" ? "right" : "left";
              if (s.kind === "line") {
                const base = chartTheme.line(0);
                return (
                  <Line
                    key={s.key}
                    yAxisId={axis}
                    dataKey={s.key}
                    name={s.name}
                    {...base}
                    stroke={fill}
                    strokeWidth={s.faint ? 1.5 : 2}
                    strokeDasharray={s.faint ? FAINT_DASH : undefined}
                    activeDot={{ ...base.activeDot, fill }}
                  />
                );
              }
              const negativeFill = TONE[s.negativeTone ?? "accent"];
              return (
                <Bar
                  key={s.key}
                  yAxisId={axis}
                  dataKey={s.key}
                  name={s.name}
                  stackId={s.stack ?? (stacked ? STACK_ID : undefined)}
                  {...chartTheme.bar(0)}
                  fill={fill}
                  // A canvas hairline between stacked segments.
                  stroke={stacked ? color.canvas : undefined}
                  strokeWidth={stacked ? 1 : undefined}
                >
                  {s.signed
                    ? data.map((d, j) => <Cell key={j} fill={num(d[s.key]) < 0 ? negativeFill : fill} />)
                    : toneKey && data.map((d, j) => <Cell key={j} fill={TONE[d[toneKey] as BarTone] ?? fill} />)}
                </Bar>
              );
            })}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <ReferenceKey items={keyItems} />
    </figure>
  );
}
