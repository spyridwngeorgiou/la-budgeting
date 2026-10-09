"use client";

import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
} from "recharts";
import { formatMoney } from "@/lib/format";

interface ChartRow {
  month: string;
  label: string;
  inflow: number;
  outflow: number;
  running: number;
  isToday: boolean;
}

// Bars for the month's own flow (in/out), a line for the running cash
// position on top -- the same two questions the table answers ("what moved
// this month" vs "where does that leave us"), just readable at a glance
// instead of read row by row. Colours reuse the app's existing sage/red
// tokens (income/expense everywhere else) rather than inventing a new scale.
export function CashflowChart({ rows, buffer }: { rows: ChartRow[]; buffer: number }) {
  const todayLabel = rows.find((r) => r.isToday)?.label;

  return (
    <div className="h-72 w-full rounded-lg border border-line bg-surface p-3">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#dcdfde" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#5b6265" }} axisLine={{ stroke: "#dcdfde" }} tickLine={false} />
          <YAxis
            tick={{ fontSize: 11, fill: "#5b6265" }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v: number) => (Math.abs(v) >= 1000 ? `${Math.round(v / 1000)}k` : String(v))}
          />
          <Tooltip
            formatter={(value: number, name: string) => [formatMoney(value), name]}
            labelStyle={{ color: "#16181a" }}
            contentStyle={{ borderRadius: 6, borderColor: "#dcdfde", fontSize: 12 }}
          />
          <ReferenceLine
            y={buffer}
            stroke="#a5341f"
            strokeDasharray="4 4"
            label={{ value: "απόθεμα ασφαλείας", position: "insideTopLeft", fontSize: 10, fill: "#a5341f" }}
          />
          {todayLabel && (
            <ReferenceLine x={todayLabel} stroke="#3a4430" strokeDasharray="2 2" />
          )}
          <Bar dataKey="inflow" name="Εισροές" fill="#b9c79e" radius={[2, 2, 0, 0]} />
          <Bar dataKey="outflow" name="Εκροές" fill="#a5341f" fillOpacity={0.55} radius={[2, 2, 0, 0]} />
          <Line
            type="monotone"
            dataKey="running"
            name="Σωρευτικό Ταμείο"
            stroke="#16181a"
            strokeWidth={2}
            dot={{ r: 2 }}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
