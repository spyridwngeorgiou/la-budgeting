import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { formatMoney } from "@/lib/format";
import type { TxDirection, TxScope } from "@/lib/domain/enums";

type GroupBy = "project" | "category" | "contact" | "account";

const DIMENSIONS: Record<
  GroupBy,
  { label: string; filterParam: string; none: string }
> = {
  project: { label: "Έργο", filterParam: "project_id", none: "Χωρίς έργο" },
  category: { label: "Κατηγορία", filterParam: "category_id", none: "Χωρίς κατηγορία" },
  contact: { label: "Επαφή", filterParam: "contact_id", none: "Χωρίς επαφή" },
  account: { label: "Λογαριασμός", filterParam: "account_id", none: "Χωρίς λογαριασμό" },
};

interface SearchParams {
  group_by?: string;
  direction?: string;
  scope?: string;
  range?: string;
}

function addMonths(monthKey: string, delta: number): string {
  const [y, m] = monthKey.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(monthKey: string) {
  const [y, m] = monthKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("el-GR", {
    month: "short",
    year: "2-digit",
    timeZone: "UTC",
  });
}

function monthRange(from: string, to: string): string[] {
  const months: string[] = [];
  const [fy, fm] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  let y = fy;
  let m = fm;
  while (y < ty || (y === ty && m <= tm)) {
    months.push(`${y}-${String(m).padStart(2, "0")}`);
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return months;
}

// Ανάλυση Κινήσεων: a real cross-tab, not a static report -- pivot by any
// dimension against months, with every cell clicking through to the exact
// transactions behind it. Pivoted in JS rather than SQL: the dataset here is
// a few hundred rows at most, and a flexible "any dimension x any month"
// crosstab in SQL would mean either a dynamic crosstab() extension or one
// query per dimension -- not worth it at this scale.
export default async function AnalysisPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const groupBy: GroupBy = (["project", "category", "contact", "account"] as const).includes(
    params.group_by as GroupBy,
  )
    ? (params.group_by as GroupBy)
    : "project";
  const direction: TxDirection | "all" =
    params.direction === "income" || params.direction === "expense" ? params.direction : "all";
  const scope: TxScope | "all" =
    params.scope === "business" || params.scope === "personal" ? params.scope : "all";
  // Default to a compact, scannable 12-month window rather than the whole
  // history -- a table that's immediately readable without scrolling is
  // friendlier than one that's technically complete but overwhelming. The
  // full history is one click away via the "range" toggle.
  const range: "12m" | "all" = params.range === "all" ? "all" : "12m";

  const supabase = await createClient();
  let query = supabase
    .from("transactions")
    .select(
      "id, tx_date, gross_amount, direction, project_id, projects(display_name), category_id, categories(name), contact_id, contacts(name), account_id, accounts(name)",
    )
    .neq("status", "cancelled")
    .order("tx_date");

  if (direction !== "all") query = query.eq("direction", direction);
  if (scope !== "all") query = query.eq("scope", scope);

  const { data: transactions } = await query;

  const dim = DIMENSIONS[groupBy];

  interface Cell {
    id: string | null;
    label: string;
    byMonth: Map<string, number>;
    total: number;
  }
  const buckets = new Map<string, Cell>();
  let minMonth: string | null = null;
  let maxMonth: string | null = null;

  for (const tx of transactions ?? []) {
    const monthKey = tx.tx_date.slice(0, 7);
    if (!minMonth || monthKey < minMonth) minMonth = monthKey;
    if (!maxMonth || monthKey > maxMonth) maxMonth = monthKey;

    let id: string | null;
    let label: string;
    if (groupBy === "project") {
      id = tx.project_id;
      const p = Array.isArray(tx.projects) ? tx.projects[0] : tx.projects;
      label = p?.display_name ?? dim.none;
    } else if (groupBy === "category") {
      id = tx.category_id;
      const c = Array.isArray(tx.categories) ? tx.categories[0] : tx.categories;
      label = c?.name ?? dim.none;
    } else if (groupBy === "contact") {
      id = tx.contact_id;
      const c = Array.isArray(tx.contacts) ? tx.contacts[0] : tx.contacts;
      label = c?.name ?? dim.none;
    } else {
      id = tx.account_id;
      const a = Array.isArray(tx.accounts) ? tx.accounts[0] : tx.accounts;
      label = a?.name ?? dim.none;
    }

    const key = id ?? `__none__:${label}`;
    const bucket = buckets.get(key) ?? { id, label, byMonth: new Map(), total: 0 };
    const signedAmount =
      direction === "all" && tx.direction === "income"
        ? Number(tx.gross_amount ?? 0)
        : direction === "all" && tx.direction === "expense"
          ? -Number(tx.gross_amount ?? 0)
          : Number(tx.gross_amount ?? 0);
    bucket.byMonth.set(monthKey, (bucket.byMonth.get(monthKey) ?? 0) + signedAmount);
    bucket.total += signedAmount;
    buckets.set(key, bucket);
  }

  // The matrix always reaches at least the current month, computed live on
  // every request -- otherwise a quiet stretch with no recent entries would
  // silently drop "today" off the end of the table instead of showing it as
  // an honest, empty column waiting to be filled in. Real future-dated
  // (scheduled) months beyond today still extend the table further, same as
  // before -- this only raises the floor, never lowers a genuine ceiling.
  const todayMonth = new Date().toISOString().slice(0, 7);
  let effectiveMin = minMonth && minMonth < todayMonth ? minMonth : todayMonth;
  const effectiveMax = maxMonth && maxMonth > todayMonth ? maxMonth : todayMonth;
  if (range === "12m") {
    const floor = addMonths(effectiveMax, -11);
    if (effectiveMin < floor) effectiveMin = floor;
  }
  const months = monthRange(effectiveMin, effectiveMax);
  const rows = [...buckets.values()].sort((a, b) => b.total - a.total);
  const columnTotals = months.map((m) =>
    rows.reduce((sum, r) => sum + (r.byMonth.get(m) ?? 0), 0),
  );
  const grandTotal = rows.reduce((sum, r) => sum + r.total, 0);

  const baseParams = new URLSearchParams();
  if (direction !== "all") baseParams.set("direction", direction);
  if (scope !== "all") baseParams.set("scope", scope);

  // Per-row magnitude shading: an instant visual read of "where's the big
  // number this year" without making anyone read every cell -- the same job
  // a colour scale does in a spreadsheet, computed relative to each row's
  // own busiest month so a small project's pattern is as legible as a large
  // one's.
  function cellShade(v: number | undefined, rowMax: number) {
    if (!v || rowMax === 0) return undefined;
    const intensity = Math.min(1, Math.abs(v) / rowMax);
    return v < 0
      ? `rgba(165,52,31,${(0.06 + intensity * 0.22).toFixed(2)})`
      : `rgba(58,68,48,${(0.05 + intensity * 0.16).toFixed(2)})`;
  }

  function cellHref(rowId: string | null, month: string) {
    const p = new URLSearchParams(baseParams);
    if (rowId) p.set(dim.filterParam, rowId);
    const [y, m] = month.split("-");
    const lastDay = new Date(Number(y), Number(m), 0).getDate();
    p.set("from", `${month}-01`);
    p.set("to", `${month}-${String(lastDay).padStart(2, "0")}`);
    return `/transactions?${p.toString()}`;
  }
  function rowHref(rowId: string | null) {
    const p = new URLSearchParams(baseParams);
    if (rowId) p.set(dim.filterParam, rowId);
    return `/transactions?${p.toString()}`;
  }
  function columnHref(month: string) {
    const p = new URLSearchParams(baseParams);
    const [y, m] = month.split("-");
    const lastDay = new Date(Number(y), Number(m), 0).getDate();
    p.set("from", `${month}-01`);
    p.set("to", `${month}-${String(lastDay).padStart(2, "0")}`);
    return `/transactions?${p.toString()}`;
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold">Ανάλυση Κινήσεων</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Επιλέξτε πώς θέλετε να ομαδοποιήσετε τα δεδομένα. Κάθε ποσό στον πίνακα είναι κλικάρισμα
          — σας πάει κατευθείαν στις κινήσεις που το απαρτίζουν.
        </p>
      </div>

      <div className="flex flex-wrap gap-4 rounded-md border border-line bg-surface p-3 text-sm">
        <FilterGroup label="Ομαδοποίηση κατά" param="group_by" value={groupBy} current={params}
          options={[
            { value: "project", label: "Έργο" },
            { value: "category", label: "Κατηγορία" },
            { value: "contact", label: "Επαφή" },
            { value: "account", label: "Λογαριασμός" },
          ]}
        />
        <FilterGroup label="Κατεύθυνση" param="direction" value={direction} current={params}
          options={[
            { value: "all", label: "Όλα (καθαρό)" },
            { value: "expense", label: "Έξοδα" },
            { value: "income", label: "Έσοδα" },
          ]}
        />
        <FilterGroup label="Πεδίο" param="scope" value={scope} current={params}
          options={[
            { value: "all", label: "Όλα" },
            { value: "business", label: "Επιχειρηματικό" },
            { value: "personal", label: "Προσωπικό" },
          ]}
        />
        <FilterGroup label="Περίοδος" param="range" value={range} current={params}
          options={[
            { value: "12m", label: "Τελευταίοι 12 μήνες" },
            { value: "all", label: "Όλο το ιστορικό" },
          ]}
        />
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-ink-muted">Δεν βρέθηκαν κινήσεις για αυτά τα φίλτρα.</p>
      ) : (
        <div className="overflow-x-auto rounded border border-line">
          <table className="w-full border-collapse text-left text-xs">
            <thead className="bg-bg text-ink-muted">
              <tr>
                <th className="sticky left-0 z-10 bg-bg p-2 whitespace-nowrap">{dim.label}</th>
                {months.map((m) => (
                  <th
                    key={m}
                    className={`p-2 text-right whitespace-nowrap ${m === todayMonth ? "bg-sage text-sage-ink" : ""}`}
                  >
                    <Link href={columnHref(m)} className="hover:underline">
                      {monthLabel(m)}
                    </Link>
                    {m === todayMonth && <div className="text-[10px] font-normal">σήμερα</div>}
                  </th>
                ))}
                <th className="p-2 text-right whitespace-nowrap font-semibold">Σύνολο</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const rowMax = Math.max(0, ...[...row.byMonth.values()].map((v) => Math.abs(v)));
                return (
                  <tr key={row.id ?? row.label} className="border-t border-line">
                    <td className="sticky left-0 z-10 bg-surface p-2 font-medium whitespace-nowrap">
                      <Link href={rowHref(row.id)} className="hover:underline">
                        {row.label}
                      </Link>
                    </td>
                    {months.map((m) => {
                      const v = row.byMonth.get(m);
                      return (
                        <td
                          key={m}
                          className="p-2 text-right font-mono whitespace-nowrap"
                          style={{ backgroundColor: cellShade(v, rowMax) }}
                        >
                          {v ? (
                            <Link
                              href={cellHref(row.id, m)}
                              className={`hover:underline ${v < 0 ? "text-red-ink" : ""}`}
                            >
                              {formatMoney(v)}
                            </Link>
                          ) : (
                            <span className="text-ink-faint">—</span>
                          )}
                        </td>
                      );
                    })}
                    <td className="p-2 text-right font-mono font-semibold">{formatMoney(row.total)}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-line-strong font-semibold">
                <td className="sticky left-0 z-10 bg-bg p-2">Σύνολο</td>
                {columnTotals.map((v, i) => (
                  <td key={months[i]} className="p-2 text-right font-mono">
                    {formatMoney(v)}
                  </td>
                ))}
                <td className="p-2 text-right font-mono">{formatMoney(grandTotal)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}

function FilterGroup({
  label,
  param,
  value,
  current,
  options,
}: {
  label: string;
  param: string;
  value: string;
  current: SearchParams;
  options: { value: string; label: string }[];
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-ink-muted">{label}:</span>
      <div className="flex gap-1">
        {options.map((o) => {
          const p = new URLSearchParams();
          for (const [k, v] of Object.entries(current)) {
            if (typeof v === "string") p.set(k, v);
          }
          p.set(param, o.value);
          const active = value === o.value;
          return (
            <Link
              key={o.value}
              href={`/analysis?${p.toString()}`}
              className={`rounded px-2 py-1 ${active ? "bg-ink text-white" : "bg-bg text-ink-muted hover:bg-line"}`}
            >
              {o.label}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
