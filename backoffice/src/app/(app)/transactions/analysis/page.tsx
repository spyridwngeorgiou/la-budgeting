import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { formatMoney } from "@/lib/format";
import type { TxDirection, TxScope } from "@/lib/domain/enums";
import { AiSpark, FilterChip, LINK_CLASS, PageHeader, SpecTable, Td, Th, Tr, buttonClass } from "@/components/ui";
import { addMonths, currentMonthKey, monthRange, monthsBetween, shortMonthYearLabel } from "@/lib/dates";
import { getCurrentOrgId } from "@/lib/supabase/org";

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
  const orgId = await getCurrentOrgId(supabase);
  let query = supabase
    .from("transactions")
    .select(
      "id, tx_date, gross_amount, direction, project_id, projects(display_name), category_id, categories(name), contact_id, contacts(name), account_id, accounts(name)",
    )
    .eq("org_id", orgId)
    // What happened: paid and pending only. Scheduled rows are the future --
    // the cash forecast and the P&L («Με προγραμματισμένα») show them.
    .in("status", ["paid", "pending"])
    .order("tx_date");

  if (direction !== "all") query = query.eq("direction", direction);
  if (scope !== "all") query = query.eq("scope", scope);

  const { data: transactions, error: queryError } = await query;
  if (queryError) throw new Error(`Η φόρτωση κινήσεων απέτυχε: ${queryError.message}`);

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
  const todayMonth = currentMonthKey();
  let effectiveMin = minMonth && minMonth < todayMonth ? minMonth : todayMonth;
  let effectiveMax = maxMonth && maxMonth > todayMonth ? maxMonth : todayMonth;
  if (range === "12m") {
    // Exactly 12 months, today-11 .. today -- anchored to today on both
    // ends. A future-dated scheduled transaction must not push either edge:
    // extending the ceiling would make "last 12 months" show 13+ columns,
    // and anchoring the floor to that ceiling would shift the whole window
    // forward, silently dropping real recent months off the start. Only
    // "όλο το ιστορικό" (range=all) shows genuine future months.
    effectiveMax = todayMonth;
    const floor = addMonths(todayMonth, -11);
    if (effectiveMin < floor) effectiveMin = floor;
  }
  const months = monthsBetween(effectiveMin, effectiveMax);
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
  // one's. One hue (the accent, through its token) for both directions: the
  // sign on the figure says which way the money went, not a red or green.
  function cellShade(v: number | undefined, rowMax: number) {
    if (!v || rowMax === 0) return undefined;
    const intensity = Math.min(1, Math.abs(v) / rowMax);
    return `color-mix(in srgb, var(--color-accent) ${Math.round(6 + intensity * 22)}%, transparent)`;
  }

  // «Όλα (καθαρό)» mixes income and expense, so every figure carries its
  // sign; a single direction is all one kind and needs none.
  const fmt = (v: number) =>
    direction === "all" ? `${v > 0 ? "+" : v < 0 ? "−" : ""}${formatMoney(Math.abs(v))}` : formatMoney(v);

  function cellHref(rowId: string | null, month: string) {
    const p = new URLSearchParams(baseParams);
    if (rowId) p.set(dim.filterParam, rowId);
    const { start, end } = monthRange(month);
    p.set("from", start);
    p.set("to", end);
    return `/transactions?${p.toString()}`;
  }
  function rowHref(rowId: string | null) {
    const p = new URLSearchParams(baseParams);
    if (rowId) p.set(dim.filterParam, rowId);
    return `/transactions?${p.toString()}`;
  }
  function columnHref(month: string) {
    const p = new URLSearchParams(baseParams);
    const { start, end } = monthRange(month);
    p.set("from", start);
    p.set("to", end);
    return `/transactions?${p.toString()}`;
  }

  const askPrompt = `Ανάλυσε τον πίνακα κινήσεων ομαδοποιημένο κατά ${dim.label.toLowerCase()}${
    direction !== "all" ? `, μόνο ${direction === "income" ? "έσοδα" : "έξοδα"}` : ""
  }${scope !== "all" ? `, πεδίο ${scope === "business" ? "επιχειρηματικό" : "προσωπικό"}` : ""}. Ποιες γραμμές ξεχωρίζουν και γιατί;`;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Ανάλυση Κινήσεων"
        meta="Επιλέξτε πώς θέλετε να ομαδοποιήσετε τα δεδομένα. Κάθε ποσό στον πίνακα είναι κλικάρισμα — σας πάει κατευθείαν στις κινήσεις που το απαρτίζουν."
        actions={
          <Link
            href={`/assistant?q=${encodeURIComponent(askPrompt)}`}
            className={buttonClass("ai", "md", "max-md:whitespace-normal")}
          >
            <AiSpark />
            Ρώτα το Kansha AI γι&apos; αυτόν τον πίνακα →
          </Link>
        }
      />

      <div className="grid grid-cols-1 gap-x-8 gap-y-4 border-b border-hairline pb-4 md:flex md:flex-wrap md:items-start">
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
        <p className="border-y border-hairline py-6 text-body text-muted">Δεν βρέθηκαν κινήσεις για αυτά τα φίλτρα.</p>
      ) : (
        // The months ARE the content: the table scrolls sideways inside its
        // own frame on a phone, the first column stays put.
        <SpecTable label="Ανάλυση κινήσεων ανά μήνα" stickyFirst tableClassName="text-small">
          <thead>
            <tr>
              <Th>{dim.label}</Th>
              {months.map((m) => (
                <Th key={m} numeric aria-current={m === todayMonth ? "date" : undefined}>
                  <Link
                    href={columnHref(m)}
                    className={`underline-offset-4 hover:text-ink hover:underline ${m === todayMonth ? "text-ink" : ""}`}
                  >
                    {shortMonthYearLabel(m)}
                  </Link>
                  {m === todayMonth && <div className="mt-0.5 text-small font-medium tracking-normal normal-case text-accent-ink">σήμερα</div>}
                </Th>
              ))}
              <Th numeric>
                <span className="text-ink">Σύνολο</span>
              </Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const rowMax = Math.max(0, ...[...row.byMonth.values()].map((v) => Math.abs(v)));
              return (
                <Tr key={row.id ?? row.label}>
                  <Td className="whitespace-nowrap">
                    <Link href={rowHref(row.id)} className={LINK_CLASS}>
                      {row.label}
                    </Link>
                  </Td>
                  {months.map((m) => {
                    const v = row.byMonth.get(m);
                    return (
                      <Td key={m} numeric style={{ backgroundColor: cellShade(v, rowMax) }}>
                        {v ? (
                          <Link href={cellHref(row.id, m)} className="underline-offset-4 hover:text-ink hover:underline">
                            {fmt(v)}
                          </Link>
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </Td>
                    );
                  })}
                  <Td numeric strong className="font-medium">
                    {fmt(row.total)}
                  </Td>
                </Tr>
              );
            })}
          </tbody>
          <tfoot>
            <Tr total>
              <Td>Σύνολο</Td>
              {columnTotals.map((v, i) => (
                <Td key={months[i]} numeric>
                  {fmt(v)}
                </Td>
              ))}
              <Td numeric>{fmt(grandTotal)}</Td>
            </Tr>
          </tfoot>
        </SpecTable>
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
    <div role="group" aria-label={label} className="flex min-w-0 flex-none flex-col gap-1.5">
      <span className="eyebrow text-muted">{label}</span>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => {
          const p = new URLSearchParams();
          for (const [k, v] of Object.entries(current)) {
            if (typeof v === "string") p.set(k, v);
          }
          p.set(param, o.value);
          return (
            <FilterChip
              key={o.value}
              href={`/transactions/analysis?${p.toString()}`}
              active={value === o.value}
              className="max-md:min-h-11"
            >
              {o.label}
            </FilterChip>
          );
        })}
      </div>
    </div>
  );
}
