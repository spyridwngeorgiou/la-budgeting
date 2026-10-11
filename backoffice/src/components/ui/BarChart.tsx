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
import { CHART_HEIGHT_CLASS, ReferenceKey, chartTheme, compactNumber } from "./chart";
import { color } from "./tokens";

// Bars (and an optional line or two) on the chart theme, for the report
// tabs: in/out per month with the running balance, revenue/cost with the
// result, a signed VAT position, a composition in horizontal rows. Props
// are plain data only, so a server component can render it directly; every
// value is money (formatted here). Imported directly from
// "@/components/ui/BarChart" so recharts never rides in through the barrel.
//
// At most three colours: navy, the accent and (for what is owed / lost)
// the negative. A comparison line is the accent, thin and dashed.

export type BarTone = "navy" | "accent" | "negative";

const TONE: Record<BarTone, string> = {
  navy: color.navy,
  accent: color.accent,
  negative: color.negative,
};

export interface BarSeries {
  key: string;
  name: string;
  // "bar" (default) or "line" -- one value axis for both, always money.
  kind?: "bar" | "line";
  tone?: BarTone;
  // A line drawn thin and dashed, for a comparison (last year).
  faint?: boolean;
  // Bars with the same stack id share one column (a signed position).
  stack?: string;
}

export type BarDatum = Record<string, string | number | null>;

const FAINT_DASH = "4 3";
const CATEGORY_WIDTH = 132;

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
  className?: string;
}) {
  const rows = layout === "rows";
  // Rows grow with the data; columns take one of the two chart heights.
  const style = rows ? { height: Math.max(120, data.length * 30 + 40) } : undefined;
  const toneOf = (s: BarSeries, i: number) => (s.faint ? color.accent : TONE[s.tone ?? (i === 0 ? "navy" : "accent")]);
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
              <YAxis type="category" dataKey={xKey} {...chartTheme.yAxis} width={CATEGORY_WIDTH} interval={0} tick={<CategoryTick />} />
            ) : (
              <YAxis {...chartTheme.yAxis} tickFormatter={compactNumber} />
            )}
            <Tooltip {...chartTheme.tooltip} formatter={(value: number, name: string) => [formatMoney(value), name]} />
            {showLegend && <Legend {...chartTheme.legend} payload={legendPayload} />}
            <ReferenceLine {...(rows ? { x: 0 } : { y: 0 })} {...chartTheme.zero} />
            {threshold && <ReferenceLine y={threshold.value} {...chartTheme.threshold} />}
            {marker && <ReferenceLine x={marker.x} {...chartTheme.today} />}
            {series.map((s, i) => {
              const fill = toneOf(s, i);
              if (s.kind === "line") {
                const base = chartTheme.line(0);
                return (
                  <Line
                    key={s.key}
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
              return (
                <Bar key={s.key} dataKey={s.key} name={s.name} stackId={s.stack} {...chartTheme.bar(0)} fill={fill}>
                  {toneKey && data.map((d, j) => <Cell key={j} fill={TONE[d[toneKey] as BarTone] ?? fill} />)}
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
