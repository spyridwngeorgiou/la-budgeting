"use client";

import { CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatMoney } from "@/lib/format";
import { cn } from "./cn";
import { CHART_HEIGHT_CLASS, ReferenceKey, chartTheme, compactNumber } from "./chart";

// One or two lines over time on the chart theme, with a crosshair tooltip,
// an optional threshold (the cash buffer) and a «today» marker. Anything
// fancier builds on chartTheme directly. One of the two chart heights.
export function TrendChart<T extends Record<string, unknown>>({
  data,
  xKey,
  series,
  format = formatMoney,
  threshold,
  todayX,
  label,
  className = "",
}: {
  data: T[];
  xKey: keyof T & string;
  series: [{ key: keyof T & string; name: string }] | [{ key: keyof T & string; name: string }, { key: keyof T & string; name: string }];
  // Defaults to money. A server component must leave it out: a function
  // cannot cross into this client component.
  format?: (n: number) => string;
  threshold?: { value: number; label: string };
  todayX?: string;
  // Accessible name of the chart («Ταμείο, επόμενοι 12 μήνες»).
  label: string;
  className?: string;
}) {
  return (
    <figure aria-label={label} className={cn("w-full min-w-0", className)}>
      <div className={CHART_HEIGHT_CLASS}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid {...chartTheme.grid} />
            <XAxis dataKey={xKey} {...chartTheme.xAxis} />
            <YAxis {...chartTheme.yAxis} tickFormatter={compactNumber} />
            <Tooltip {...chartTheme.tooltip} formatter={(v: number) => format(v)} />
            {series.length > 1 && <Legend {...chartTheme.legend} />}
            {threshold && <ReferenceLine y={threshold.value} {...chartTheme.threshold} />}
            {todayX && <ReferenceLine x={todayX} {...chartTheme.today} />}
            {series.map((s, i) => (
              <Line key={s.key} dataKey={s.key} name={s.name} {...chartTheme.line(i as 0 | 1)} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <ReferenceKey items={threshold ? [{ label: threshold.label, kind: "threshold" }] : []} />
    </figure>
  );
}
