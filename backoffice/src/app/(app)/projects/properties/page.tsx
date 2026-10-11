import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrgId } from "@/lib/supabase/org";
import { formatMoney } from "@/lib/format";
import { el } from "@/lib/i18n/el";
import { addMonths, currentMonthKey, isMonthKey, monthRange } from "@/lib/dates";
import { ButtonLink, PageHeader } from "@/components/ui";

// P15 spec table: uppercase 12px head over the navy rule, hairline rows,
// a total row over an ink rule.
const TH = "eyebrow border-b border-rule px-3 py-2.5 font-medium whitespace-nowrap text-muted";
const TD = "border-b border-hairline px-3 py-3";
const TF = "border-t border-ink px-3 py-3 font-medium whitespace-nowrap text-ink";

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
    <div className="flex flex-col gap-6">
      <PageHeader
        title={el.nav.properties}
        meta={
          <span className="block max-w-prose">
            Κόστος λειτουργίας ανά ακίνητο: ενοίκιο, παροχές, κοινόχρηστα. Εταιρικές κινήσεις του έργου μαζί με
            προσωπικά έξοδα που έχουν χαρακτηριστεί με το ακίνητο. Οι δαπάνες ανάπτυξης (προϋπολογισμός) δεν
            μετράνε εδώ.
          </span>
        }
        actions={
          <div className="flex items-center gap-1 text-sm">
            <ButtonLink
              href={`/projects/properties?month=${addMonths(month, -1)}`}
              variant="ghost"
              aria-label="Προηγούμενος μήνας"
              className="min-w-10 max-md:min-h-11 max-md:min-w-11"
            >
              ←
            </ButtonLink>
            <span className="num min-w-24 text-center text-ink">{monthLabel(month)}</span>
            <ButtonLink
              href={`/projects/properties?month=${addMonths(month, 1)}`}
              variant="ghost"
              aria-label="Επόμενος μήνας"
              className="min-w-10 max-md:min-h-11 max-md:min-w-11"
            >
              →
            </ButtonLink>
          </div>
        }
      />

      {/* Spec table; the buckets ARE the columns, so it scrolls inside its
          frame on a phone with the property column pinned. */}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              <th scope="col" className={`${TH} sticky left-0 z-10 bg-canvas text-left`}>
                Ακίνητο
              </th>
              {BUCKETS.map((b) => (
                <th key={b.key} scope="col" className={`${TH} text-right`}>
                  {b.label}
                </th>
              ))}
              <th scope="col" className={`${TH} text-right`}>
                Σύνολο
              </th>
            </tr>
          </thead>
          <tbody>
            {(projects ?? []).map((p) => (
              <tr key={p.id} className="hover:bg-hover">
                <th scope="row" className={`${TD} sticky left-0 min-w-36 bg-canvas text-left font-normal`}>
                  <Link href={`/projects/${p.id}`} className="text-ink underline-offset-4 hover:underline">
                    {p.display_name}
                  </Link>
                </th>
                {BUCKETS.map((b) => {
                  const c = cell(p.id, b.key);
                  const paid = Number(c?.paid_amount ?? 0);
                  const open = Number(c?.open_amount ?? 0);
                  return (
                    <td key={b.key} className={`${TD} num text-right whitespace-nowrap text-ink`}>
                      {paid || open ? (
                        <Link
                          href={`/transactions?project_id=${p.id}&direction=expense&from=${monthStart}&to=${monthEnd}`}
                          className="underline-offset-4 hover:underline"
                        >
                          {paid ? formatMoney(paid) : ""}
                          {open ? <span className="ml-1 text-muted">+{formatMoney(open)}</span> : null}
                        </Link>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                  );
                })}
                <td className={`${TD} num text-right font-medium whitespace-nowrap text-ink`}>
                  {rowTotal(p.id) ? formatMoney(rowTotal(p.id)) : <span className="font-normal text-muted">—</span>}
                  {rowOpen(p.id) ? <span className="ml-1 font-normal text-muted">+{formatMoney(rowOpen(p.id))}</span> : null}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row" className={`${TF} sticky left-0 bg-canvas text-left`}>
                Σύνολο
              </th>
              {BUCKETS.map((b) => (
                <td key={b.key} className={`${TF} num text-right`}>
                  {formatMoney(columnTotal(b.key))}
                </td>
              ))}
              <td className={`${TF} num text-right`}>{formatMoney(grandTotal)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="max-w-prose text-small text-muted">
        Πληρωμένα ποσά του μήνα· με αχνό, ό,τι είναι ακόμα εκκρεμές ή προγραμματισμένο. Οι λογαριασμοί ΔΕΗ/ΕΥΔΑΠ/internet
        αντιστοιχίζονται αυτόματα στο ακίνητο όταν αναφέρουν αριθμό παροχής από τις Παροχές του έργου.
      </p>
    </div>
  );
}
