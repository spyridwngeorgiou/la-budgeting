"use client";

import { CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatMoney } from "@/lib/format";
import { chartTheme, compactNumber } from "./chart";

// One or two lines over time on the chart theme, with a crosshair tooltip,
// an optional threshold (the cash buffer) and a «today» marker. Anything
// fancier builds on chartTheme directly.
export function TrendChart<T extends Record<string, unknown>>({
  data,
  xKey,
  series,
  format = formatMoney,
  threshold,
  todayX,
  height = 240,
  label,
}: {
  data: T[];
  xKey: keyof T & string;
  series: [{ key: keyof T & string; name: string }] | [{ key: keyof T & string; name: string }, { key: keyof T & string; name: string }];
  // Defaults to money. A server component must leave it out: a function
  // cannot cross into this client component.
  format?: (n: number) => string;
  threshold?: { value: number; label: string };
  todayX?: string;
  height?: number;
  // Accessible name of the chart («Ταμείο, επόμενοι 12 μήνες»).
  label: string;
}) {
  return (
    <figure aria-label={label} className="w-full" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid {...chartTheme.grid} />
          <XAxis dataKey={xKey} {...chartTheme.xAxis} />
          <YAxis {...chartTheme.yAxis} tickFormatter={compactNumber} />
          <Tooltip {...chartTheme.tooltip} formatter={(v: number) => format(v)} />
          {series.length > 1 && <Legend {...chartTheme.legend} />}
          {threshold && (
            <ReferenceLine
              y={threshold.value}
              {...chartTheme.threshold}
              label={{ value: threshold.label, position: "insideTopLeft", fontSize: 12, fill: chartTheme.threshold.stroke }}
            />
          )}
          {todayX && <ReferenceLine x={todayX} {...chartTheme.today} />}
          {series.map((s, i) => (
            <Line key={s.key} dataKey={s.key} name={s.name} {...chartTheme.line(i as 0 | 1)} />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </figure>
  );
}
