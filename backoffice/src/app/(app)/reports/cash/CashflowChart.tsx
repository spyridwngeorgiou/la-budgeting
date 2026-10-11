"use client";

import { ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ReferenceLine, ResponsiveContainer } from "recharts";
import { formatMoney } from "@/lib/format";
import { chartTheme, compactNumber } from "@/components/ui/chart";
import { color } from "@/components/ui/tokens";

interface ChartRow {
  month: string;
  label: string;
  inflow: number;
  outflow: number;
  running: number;
  isToday: boolean;
}

// The month's own flow (in / out) and the running cash position, the same
// two questions the table answers ("what moved this month" vs "where does
// that leave us"). P15 chart theme: lines, not fills -- the running cash is
// the solid series line, inflow dashed, outflow dotted in the muted ink, so
// the three differ by more than colour; the buffer is the dashed threshold.
export function CashflowChart({ rows, buffer }: { rows: ChartRow[]; buffer: number }) {
  const todayLabel = rows.find((r) => r.isToday)?.label;

  return (
    <figure aria-label="Σωρευτικό Ταμείο, Εισροές, Εκροές" className="h-72 w-full min-w-0">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid {...chartTheme.grid} />
          <XAxis dataKey="label" {...chartTheme.xAxis} />
          <YAxis {...chartTheme.yAxis} tickFormatter={compactNumber} />
          <Tooltip {...chartTheme.tooltip} formatter={(value: number, name: string) => [formatMoney(value), name]} />
          <Legend {...chartTheme.legend} />
          <ReferenceLine
            y={buffer}
            {...chartTheme.threshold}
            label={{ value: "απόθεμα ασφαλείας", position: "insideTopLeft", fontSize: 12, fill: chartTheme.threshold.stroke }}
          />
          {todayLabel && <ReferenceLine x={todayLabel} {...chartTheme.today} />}
          <Line dataKey="inflow" name="Εισροές" {...chartTheme.line(1)} />
          <Line
            dataKey="outflow"
            name="Εκροές"
            {...chartTheme.line(1)}
            stroke={color.muted}
            strokeDasharray="1 3"
            activeDot={{ ...chartTheme.line(1).activeDot, fill: color.muted }}
          />
          <Line dataKey="running" name="Σωρευτικό Ταμείο" {...chartTheme.line(0)} />
        </ComposedChart>
      </ResponsiveContainer>
    </figure>
  );
}
