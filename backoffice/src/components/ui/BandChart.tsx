"use client";

import {
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ReferenceArea,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatCompactMoney, formatMoney } from "@/lib/format";
import { report } from "@/lib/i18n/v2/report";
import { cn } from "./cn";
import { CHART_HEIGHT_CLASS, ReferenceKey, chartTheme, compactNumber, type ReferenceKeyKind } from "./chart";
import { minPoint, paddedDomain, type ChartDatum } from "./chartScale";
import { color } from "./tokens";

// A balance over time: 1-3 lines (the cash scenarios: base, optimistic,
// pessimistic) with the safety buffer as a dashed threshold and/or a tinted
// band, the points under the threshold marked with a dot in the negative
// colour, and the lowest point of the FIRST series labelled in place
// («χαμηλότερο −1,2 εκ. · Σεπ 27») instead of in a legend. Plain-data props
// only (a server component renders it directly); every value is money.
// Imported directly from "@/components/ui/BandChart" (recharts stays out of
// the barrel). One balance per chart: monthly flows go in their own
// BarChart, never on this axis.

export type BandTone = "navy" | "accent" | "faint";

export interface BandSeries {
  key: string;
  name: string;
  // Default: navy for the first, accent for the second, faint for the third.
  tone?: BandTone;
}

const TONE: Record<BandTone, string> = { navy: color.navy, accent: color.accent, faint: color.chipBorder };
const DEFAULT_TONES: BandTone[] = ["navy", "accent", "faint"];
// Lines differ by dash too, so identity is never colour alone.
const DASHES = [undefined, "5 4", "2 3"] as const;

export function BandChart({
  data,
  xKey,
  series,
  label,
  threshold,
  band,
  markBelow = true,
  annotateMin = true,
  todayX,
  className,
}: {
  data: ChartDatum[];
  xKey: string;
  // 1-3 lines; the first is the one that is annotated and marked.
  series: BandSeries[];
  // Accessible name of the chart.
  label: string;
  // The safety buffer: a dashed line in the negative colour.
  threshold?: { value: number; label: string };
  // A tinted horizontal zone (e.g. 0 … buffer).
  band?: { from: number; to: number; label: string };
  // Dots on the first series where it is under threshold.value. A string
  // replaces the key's text («Μήνες κάτω από το απόθεμα»).
  markBelow?: boolean | string;
  // Text at the lowest point of the first series. true: «χαμηλότερο −1,2 εκ. · {x}»;
  // a string: that text; false: none.
  annotateMin?: boolean | string;
  // A vertical «today» hairline at this x.
  todayX?: string;
  className?: string;
}) {
  const lines = series.slice(0, 3);
  const main = lines[0];
  const toneOf = (s: BandSeries, i: number) => TONE[s.tone ?? DEFAULT_TONES[i]];
  const low = main && annotateMin !== false ? minPoint(data, main.key, xKey) : null;
  const lowText = low ? (typeof annotateMin === "string" ? annotateMin : `${report.chart.lowest} ${formatCompactMoney(low.value)} · ${low.x}`) : null;
  // Room under the lowest point for its label.
  const domain = paddedDomain(
    data,
    lines.map((s) => s.key),
    [threshold?.value, band?.from, band?.to].filter((v): v is number => v != null),
    lowText ? 0.18 : 0.05,
  );
  const below =
    markBelow !== false && threshold && main ? data.some((d) => d[main.key] != null && Number(d[main.key]) < threshold.value) : false;
  // The label's anchor follows where the point sits, so it never runs off
  // either edge.
  const anchor = low && data.length > 1 ? (low.index / (data.length - 1) < 0.25 ? "start" : low.index / (data.length - 1) > 0.75 ? "end" : "middle") : "middle";

  const keyItems: { label: string; kind: ReferenceKeyKind }[] = [
    ...(threshold ? [{ label: threshold.label, kind: "threshold" as const }] : []),
    ...(band ? [{ label: band.label, kind: "band" as const }] : []),
    ...(below ? [{ label: typeof markBelow === "string" ? markBelow : report.chart.belowThreshold, kind: "below" as const }] : []),
  ];
  const legendPayload = lines.map((s, i) => ({
    value: s.name,
    type: "plainline" as const,
    color: toneOf(s, i),
    id: s.key,
    payload: { strokeDasharray: DASHES[i] ?? "0" },
  }));

  return (
    <figure aria-label={label} className={cn("w-full min-w-0 print-avoid-break", className)}>
      <div className={CHART_HEIGHT_CLASS}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
            <CartesianGrid {...chartTheme.grid} />
            <XAxis dataKey={xKey} {...chartTheme.xAxis} />
            <YAxis {...chartTheme.yAxis} tickFormatter={compactNumber} domain={domain} />
            <Tooltip {...chartTheme.tooltip} formatter={(v: number, name: string) => [formatMoney(v), name]} />
            {lines.length > 1 && <Legend {...chartTheme.legend} payload={legendPayload} />}
            {band && <ReferenceArea y1={band.from} y2={band.to} fill={color.negativeTint} fillOpacity={0.7} stroke="none" ifOverflow="hidden" />}
            {domain[0] < 0 && domain[1] > 0 && <ReferenceLine y={0} {...chartTheme.zero} />}
            {threshold && <ReferenceLine y={threshold.value} {...chartTheme.threshold} />}
            {todayX && <ReferenceLine x={todayX} {...chartTheme.today} />}
            {/* Last first, so the main line is drawn on top. */}
            {lines
              .map((s, i) => {
                const stroke = toneOf(s, i);
                const base = chartTheme.line(0);
                const isMain = i === 0;
                return (
                  <Line
                    key={s.key}
                    dataKey={s.key}
                    name={s.name}
                    {...base}
                    stroke={stroke}
                    strokeWidth={isMain ? 2 : 1.5}
                    strokeDasharray={DASHES[i]}
                    activeDot={{ ...base.activeDot, fill: stroke }}
                    dot={
                      isMain && below && threshold
                        ? (p: { cx?: number; cy?: number; index?: number; value?: number | null }) =>
                            p.value != null && p.value < threshold.value && p.cx != null && p.cy != null ? (
                              <circle key={`b${p.index}`} cx={p.cx} cy={p.cy} r={3.5} fill={color.negative} stroke={color.canvas} strokeWidth={1} />
                            ) : (
                              <g key={`b${p.index}`} />
                            )
                        : false
                    }
                  />
                );
              })
              .reverse()}
            {low && lowText && (
              <ReferenceDot
                x={low.x}
                y={low.value}
                r={4}
                fill={color.ink}
                stroke={color.canvas}
                strokeWidth={2}
                label={(p: { viewBox?: { x?: number; y?: number; width?: number; height?: number } }) => {
                  const vb = p.viewBox ?? {};
                  const cx = (vb.x ?? 0) + (vb.width ?? 0) / 2;
                  const cy = (vb.y ?? 0) + (vb.height ?? 0) / 2;
                  const dx = anchor === "start" ? -4 : anchor === "end" ? 4 : 0;
                  return (
                    <text
                      x={cx + dx}
                      y={cy + 18}
                      textAnchor={anchor}
                      fontSize={12}
                      fontWeight={500}
                      fill={color.ink}
                      stroke={color.canvas}
                      strokeWidth={3}
                      paintOrder="stroke"
                      fontFamily="var(--font-sans)"
                    >
                      {lowText}
                    </text>
                  );
                }}
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <ReferenceKey items={keyItems} />
    </figure>
  );
}
