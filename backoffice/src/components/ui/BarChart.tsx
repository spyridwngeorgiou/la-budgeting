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
import { chartTheme, compactNumber } from "./chart";
import { color } from "./tokens";

// Bars (and an optional line or two) on the chart theme, for the report
// tabs: in/out per month with the running balance, revenue/cost with the
// result, a signed VAT position, a composition in horizontal rows. Props
// are plain data only, so a server component can render it directly; every
// value is money (formatted here). Imported directly from
// "@/components/ui/BarChart" so recharts never rides in through the barrel.

export type BarTone = "navy" | "accent" | "ink" | "muted" | "negative";

const TONE: Record<BarTone, string> = {
  navy: color.navy,
  accent: color.accent,
  ink: color.ink,
  muted: color.chipBorder,
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
  // Rows grow with the data; columns are ~220px, smaller on phones.
  const style = rows ? { height: Math.max(120, data.length * 30 + 40) } : undefined;
  const legendPayload = legend
    ? legend.map((l) => ({ value: l.name, type: "square" as const, color: TONE[l.tone], id: l.name, payload: { strokeDasharray: "0" } }))
    : series.map((s, i) => ({
        value: s.name,
        type: (s.kind === "line" ? "plainline" : "square") as "plainline" | "square",
        color: s.faint ? color.chipBorder : TONE[s.tone ?? (i === 0 ? "navy" : "accent")],
        id: s.key,
        // recharts draws a "plainline" legend icon from payload.strokeDasharray
        // and throws in the browser when payload is missing (it crashed the
        // cash and P&L reports, the two charts with a line).
        payload: { strokeDasharray: s.faint ? "4 3" : "0" },
      }));
  const showLegend = legend ? legend.length > 1 : series.length > 1;

  return (
    <figure aria-label={label} className={cn("w-full min-w-0", !rows && "h-44 md:h-[220px]", className)} style={style}>
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
            <YAxis type="category" dataKey={xKey} {...chartTheme.yAxis} width={128} interval={0} />
          ) : (
            <YAxis {...chartTheme.yAxis} tickFormatter={compactNumber} />
          )}
          <Tooltip
            {...chartTheme.tooltip}
            cursor={{ fill: color.hover }}
            formatter={(value: number, name: string) => [formatMoney(value), name]}
          />
          {showLegend && <Legend {...chartTheme.legend} payload={legendPayload} />}
          <ReferenceLine {...(rows ? { x: 0 } : { y: 0 })} {...chartTheme.zero} />
          {threshold && (
            <ReferenceLine
              y={threshold.value}
              {...chartTheme.threshold}
              label={{ value: threshold.label, position: "insideTopLeft", fontSize: 12, fill: chartTheme.threshold.stroke }}
            />
          )}
          {marker && (
            <ReferenceLine
              x={marker.x}
              {...chartTheme.today}
              label={marker.label ? { value: marker.label, position: "insideTopRight", fontSize: 12, fill: color.muted } : undefined}
            />
          )}
          {series.map((s, i) => {
            const fill = TONE[s.tone ?? (i === 0 ? "navy" : "accent")];
            if (s.kind === "line") {
              const base = chartTheme.line(s.faint ? 1 : 0);
              return (
                <Line
                  key={s.key}
                  dataKey={s.key}
                  name={s.name}
                  {...base}
                  stroke={s.faint ? color.chipBorder : fill}
                  strokeWidth={s.faint ? 1.5 : 2}
                  activeDot={{ ...base.activeDot, fill: s.faint ? color.chipBorder : fill }}
                />
              );
            }
            return (
              <Bar key={s.key} dataKey={s.key} name={s.name} stackId={s.stack} {...chartTheme.bar(0)} fill={fill}>
                {toneKey &&
                  data.map((d, j) => <Cell key={j} fill={TONE[(d[toneKey] as BarTone) ?? "navy"] ?? fill} />)}
              </Bar>
            );
          })}
        </ComposedChart>
      </ResponsiveContainer>
    </figure>
  );
}
