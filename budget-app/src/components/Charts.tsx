"use client";

import {
  Bar,
  BarChart,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatEuro } from "@/lib/utils";

const COLORS = [
  "#1e3a8a",
  "#2563eb",
  "#0891b2",
  "#16a34a",
  "#eab308",
  "#f97316",
  "#dc2626",
  "#7c3aed",
  "#db2777",
  "#64748b",
];

export function BarChartCard({
  data,
}: {
  data: { name: string; value: number }[];
}) {
  if (!data.length)
    return <EmptyChart label="Δεν υπάρχουν δεδομένα ακόμη" />;
  return (
    <ResponsiveContainer width="100%" height={280}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
        <XAxis
          dataKey="name"
          tick={{ fontSize: 12, fill: "#64748b" }}
          interval={0}
          angle={-15}
          textAnchor="end"
          height={60}
        />
        <YAxis
          tick={{ fontSize: 12, fill: "#64748b" }}
          tickFormatter={(v: number) => formatEuro(v)}
          width={80}
        />
        <Tooltip
          formatter={(v) => formatEuro(Number(v))}
          cursor={{ fill: "rgba(30,58,138,0.06)" }}
        />
        <Bar dataKey="value" radius={[6, 6, 0, 0]}>
          {data.map((_, i) => (
            <Cell key={i} fill={COLORS[i % COLORS.length]} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function PieChartCard({
  data,
}: {
  data: { name: string; value: number }[];
}) {
  if (!data.length)
    return <EmptyChart label="Δεν υπάρχουν δεδομένα ακόμη" />;
  return (
    <ResponsiveContainer width="100%" height={280}>
      <PieChart>
        <Pie
          data={data}
          dataKey="value"
          nameKey="name"
          cx="50%"
          cy="50%"
          outerRadius={100}
          innerRadius={55}
          paddingAngle={2}
        >
          {data.map((_, i) => (
            <Cell key={i} fill={COLORS[i % COLORS.length]} />
          ))}
        </Pie>
        <Tooltip formatter={(v) => formatEuro(Number(v))} />
      </PieChart>
    </ResponsiveContainer>
  );
}

function EmptyChart({ label }: { label: string }) {
  return (
    <div className="flex h-[280px] items-center justify-center text-sm text-muted">
      {label}
    </div>
  );
}

export function ChartLegend({
  data,
}: {
  data: { name: string; value: number }[];
}) {
  return (
    <ul className="mt-4 space-y-1">
      {data.map((d, i) => (
        <li
          key={d.name}
          className="flex items-center justify-between text-sm"
        >
          <span className="flex items-center gap-2">
            <span
              className="inline-block h-3 w-3 rounded-sm"
              style={{ background: COLORS[i % COLORS.length] }}
            />
            {d.name}
          </span>
          <span className="font-medium">{formatEuro(d.value)}</span>
        </li>
      ))}
    </ul>
  );
}
