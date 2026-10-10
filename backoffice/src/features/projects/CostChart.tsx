"use client";

import { TrendChart } from "@/components/ui/TrendChart";
import { formatMoney } from "@/lib/format";

// TrendChart takes a formatter, which cannot cross from a server component;
// this is its client-side wrapper for the «Κόστος χρήσης» months.
export function CostChart({ data, label, series }: { data: { month: string; paid: number }[]; label: string; series: string }) {
  return <TrendChart data={data} xKey="month" series={[{ key: "paid", name: series }]} format={formatMoney} label={label} height={200} />;
}
