import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrgId } from "@/lib/supabase/org";
import { formatMoney } from "@/lib/format";
import { el } from "@/lib/i18n/el";
import { addMonths, currentMonthKey, isMonthKey, monthRange } from "@/lib/dates";

// The workbook's Πληρωμές «Κόστος ανά ακίνητο — τρέχων μήνας», minus its two
// bugs (rent summed with no month filter; Internet/Λοιπά never filled in).
// Buckets come from v_property_monthly_cost (0028); a cell is paid money,
// with anything still pending/scheduled for the month shown faint beside it.
const BUCKETS = [
  { key: "rent", label: "Ενοίκιο" },
  { key: "utilities", label: "ΔΕΗ & νερό" },
  { key: "internet", label: "Internet" },
  { key: "building_fees", label: "Κοινόχρηστα" },
  { key: "other", label: "Λοιπά" },
] as const;

const MONTHS_EL = ["Ιαν", "Φεβ", "Μαρ", "Απρ", "Μάι", "Ιούν", "Ιούλ", "Αύγ", "Σεπ", "Οκτ", "Νοέ", "Δεκ"];

function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return `${MONTHS_EL[m - 1]} ${y}`;
}

export default async function PropertiesPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const { month: requested } = await searchParams;
  const month = isMonthKey(requested) ? requested : currentMonthKey();
  const { start: monthStart, end: monthEnd } = monthRange(month);

  const supabase = await createClient();
  const orgId = await getCurrentOrgId(supabase);
  const [{ data: projects }, { data: costs }] = await Promise.all([
    supabase.from("projects").select("id, code, display_name").eq("org_id", orgId).neq("code", "Q000_GENERAL").order("sort_order"),
    supabase.from("v_property_monthly_cost").select("*").eq("org_id", orgId).eq("month", monthStart),
  ]);

  const cell = (projectId: string, bucket: string) =>
    (costs ?? []).find((c) => c.project_id === projectId && c.bucket === bucket);
  const rowTotal = (projectId: string) =>
    (costs ?? []).filter((c) => c.project_id === projectId).reduce((s, c) => s + Number(c.paid_amount ?? 0), 0);
  const rowOpen = (projectId: string) =>
    (costs ?? []).filter((c) => c.project_id === projectId).reduce((s, c) => s + Number(c.open_amount ?? 0), 0);
  const columnTotal = (bucket: string) =>
    (costs ?? []).filter((c) => c.bucket === bucket).reduce((s, c) => s + Number(c.paid_amount ?? 0), 0);
  const grandTotal = (costs ?? []).reduce((s, c) => s + Number(c.paid_amount ?? 0), 0);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{el.nav.properties}</h1>
          <p className="mt-1 text-sm text-ink-muted">
            Κόστος λειτουργίας ανά ακίνητο: ενοίκιο, παροχές, κοινόχρηστα. Εταιρικές κινήσεις του έργου μαζί με
            προσωπικά έξοδα που έχουν χαρακτηριστεί με το ακίνητο. Οι δαπάνες ανάπτυξης (προϋπολογισμός) δεν
            μετράνε εδώ.
          </p>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <Link href={`/properties?month=${addMonths(month, -1)}`} className="rounded-md border border-line px-2 py-1 hover:bg-bg">
            ←
          </Link>
          <span className="min-w-24 text-center font-medium">{monthLabel(month)}</span>
          <Link href={`/properties?month=${addMonths(month, 1)}`} className="rounded-md border border-line px-2 py-1 hover:bg-bg">
            →
          </Link>
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-line bg-surface">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-line text-ink-muted">
              <th className="p-3 text-left font-medium">Ακίνητο</th>
              {BUCKETS.map((b) => (
                <th key={b.key} className="p-3 text-right font-medium">
                  {b.label}
                </th>
              ))}
              <th className="p-3 text-right font-semibold text-ink">Σύνολο</th>
            </tr>
          </thead>
          <tbody>
            {(projects ?? []).map((p) => (
              <tr key={p.id} className="border-b border-line last:border-0">
                <td className="p-3">
                  <Link href={`/projects/${p.id}`} className="hover:underline">
                    {p.display_name}
                  </Link>
                </td>
                {BUCKETS.map((b) => {
                  const c = cell(p.id, b.key);
                  const paid = Number(c?.paid_amount ?? 0);
                  const open = Number(c?.open_amount ?? 0);
                  return (
                    <td key={b.key} className="p-3 text-right font-mono tabular-nums">
                      {paid || open ? (
                        <Link
                          href={`/transactions?project_id=${p.id}&direction=expense&from=${monthStart}&to=${monthEnd}`}
                          className="hover:underline"
                        >
                          {paid ? formatMoney(paid) : ""}
                          {open ? <span className="ml-1 text-ink-faint">+{formatMoney(open)}</span> : null}
                        </Link>
                      ) : (
                        <span className="text-ink-faint">—</span>
                      )}
                    </td>
                  );
                })}
                <td className="p-3 text-right font-mono font-semibold tabular-nums">
                  {rowTotal(p.id) ? formatMoney(rowTotal(p.id)) : <span className="font-normal text-ink-faint">—</span>}
                  {rowOpen(p.id) ? <span className="ml-1 font-normal text-ink-faint">+{formatMoney(rowOpen(p.id))}</span> : null}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-line-strong font-semibold">
              <td className="p-3">Σύνολο</td>
              {BUCKETS.map((b) => (
                <td key={b.key} className="p-3 text-right font-mono tabular-nums">
                  {formatMoney(columnTotal(b.key))}
                </td>
              ))}
              <td className="p-3 text-right font-mono tabular-nums">{formatMoney(grandTotal)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="text-xs text-ink-faint">
        Πληρωμένα ποσά του μήνα· με αχνό, ό,τι είναι ακόμα εκκρεμές ή προγραμματισμένο. Οι λογαριασμοί ΔΕΗ/ΕΥΔΑΠ/internet
        αντιστοιχίζονται αυτόματα στο ακίνητο όταν αναφέρουν αριθμό παροχής από τις Παροχές του έργου.
      </p>
    </div>
  );
}
