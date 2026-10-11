"use client";

import { Bar, CartesianGrid, ComposedChart, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CHART_HEIGHT_CLASS, chartTheme, compactNumber } from "@/components/ui/chart";
import { formatMoney } from "@/lib/format";

// Inflow / outflow per month for one account: two thin bar series on the
// shared chart theme (ComposedChart, so the cursor is the theme's hairline).
// Plain data props only (no functions from the server).
export function LedgerChart({
  data,
  inflowLabel,
  outflowLabel,
  label,
}: {
  data: { label: string; inflow: number; outflow: number }[];
  inflowLabel: string;
  outflowLabel: string;
  label: string;
}) {
  return (
    <figure aria-label={label} className={`w-full min-w-0 ${CHART_HEIGHT_CLASS}`}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barGap={2}>
          <CartesianGrid {...chartTheme.grid} />
          <XAxis dataKey="label" {...chartTheme.xAxis} />
          <YAxis {...chartTheme.yAxis} tickFormatter={compactNumber} />
          <Tooltip {...chartTheme.tooltip} formatter={(v: number) => formatMoney(v)} />
          <Legend {...chartTheme.legend} />
          <Bar dataKey="inflow" name={inflowLabel} {...chartTheme.bar(0)} />
          <Bar dataKey="outflow" name={outflowLabel} {...chartTheme.bar(1)} />
        </ComposedChart>
      </ResponsiveContainer>
    </figure>
  );
}
