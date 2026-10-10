// Layout of the P&L table over pnl_summary() (0067). The SQL decides which
// line every euro lands on; this only arranges the rows into a grid and adds
// the two subtotals (gross profit, result). Pure.

import { BUSINESS_LINE } from "@/lib/domain/enums";

export const BUSINESS_LINES = BUSINESS_LINE;

// Lines as pnl_line() returns them, in statement order.
export const PNL_LINES = ["revenue", "cost_of_sales", "opex", "rent", "financing", "tax", "unclassified"] as const;
export type PnlLine = (typeof PNL_LINES)[number];
export type PnlRowKey = PnlLine | "gross_profit" | "result";
export type PnlGroup = "month" | "business_line";

export interface PnlSummaryRow {
  bucket: string;
  line: string;
  amount: number | string;
}

export interface PnlTableRow {
  line: PnlRowKey;
  values: number[]; // one per bucket, signed (+ revenue, − cost)
  total: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function pnlTable(rows: PnlSummaryRow[], buckets: string[]): { rows: PnlTableRow[] } {
  const index = new Map(buckets.map((b, i) => [b, i]));
  const grid = new Map<string, number[]>(PNL_LINES.map((l) => [l, buckets.map(() => 0)]));
  for (const r of rows) {
    const i = index.get(r.bucket);
    const line = grid.get(r.line);
    if (i === undefined || !line) continue;
    line[i] += Number(r.amount);
  }
  const sum = (lines: PnlLine[]) => buckets.map((_, i) => lines.reduce((s, l) => s + grid.get(l)![i], 0));
  const make = (line: PnlRowKey, values: number[]): PnlTableRow => {
    const v = values.map(round2);
    return { line, values: v, total: round2(v.reduce((s, x) => s + x, 0)) };
  };
  const out: PnlTableRow[] = [
    make("revenue", grid.get("revenue")!),
    make("cost_of_sales", grid.get("cost_of_sales")!),
    make("gross_profit", sum(["revenue", "cost_of_sales"])),
    ...(["opex", "rent", "financing", "tax", "unclassified"] as const).map((l) => make(l, grid.get(l)!)),
    make("result", sum([...PNL_LINES])),
  ];
  return { rows: out };
}
