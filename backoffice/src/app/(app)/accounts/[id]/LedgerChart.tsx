"use client";

import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { chartTheme, compactNumber } from "@/components/ui/chart";
import { formatMoney } from "@/lib/format";

// Inflow / outflow per month for one account: two thin bar series on the
// shared chart theme. Plain data props only (no functions from the server).
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
    <figure aria-label={label} className="h-44 w-full md:h-56">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barGap={2}>
          <CartesianGrid {...chartTheme.grid} />
          <XAxis dataKey="label" {...chartTheme.xAxis} />
          <YAxis {...chartTheme.yAxis} tickFormatter={compactNumber} />
          <Tooltip {...chartTheme.tooltip} cursor={{ fill: "transparent" }} formatter={(v: number) => formatMoney(v)} />
          <Legend {...chartTheme.legend} iconType="square" />
          <Bar dataKey="inflow" name={inflowLabel} {...chartTheme.bar(0)} />
          <Bar dataKey="outflow" name={outflowLabel} {...chartTheme.bar(1)} />
        </BarChart>
      </ResponsiveContainer>
    </figure>
  );
}
