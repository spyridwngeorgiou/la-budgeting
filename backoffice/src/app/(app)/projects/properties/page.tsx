import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrgId } from "@/lib/supabase/org";
import { formatMoney } from "@/lib/format";
import { el } from "@/lib/i18n/el";
import { addMonths, currentMonthKey, isMonthKey, monthRange } from "@/lib/dates";
import { ButtonLink, LINK_CLASS, PageHeader, TD_CLASS, SpecTable, Td, Th, Tr } from "@/components/ui";

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
          <div className="flex items-center gap-1 text-body">
            <ButtonLink
              href={`/projects/properties?month=${addMonths(month, -1)}`}
              variant="ghost"
              aria-label="Προηγούμενος μήνας"
              className="min-w-10 max-md:min-w-11"
            >
              ←
            </ButtonLink>
            <span className="num min-w-24 text-center text-ink">{monthLabel(month)}</span>
            <ButtonLink
              href={`/projects/properties?month=${addMonths(month, 1)}`}
              variant="ghost"
              aria-label="Επόμενος μήνας"
              className="min-w-10 max-md:min-w-11"
            >
              →
            </ButtonLink>
          </div>
        }
      />

      {/* Spec table; the buckets ARE the columns, so it scrolls inside its
          frame on a phone with the property column pinned. */}
      <SpecTable label="Κόστος ανά ακίνητο" stickyFirst>
        <thead>
          <tr>
            <Th>Ακίνητο</Th>
            {BUCKETS.map((b) => (
              <Th key={b.key} numeric>
                {b.label}
              </Th>
            ))}
            <Th numeric>Σύνολο</Th>
          </tr>
        </thead>
        <tbody>
          {(projects ?? []).map((p) => (
            <Tr key={p.id}>
              <th scope="row" className={`${TD_CLASS} min-w-36 text-left font-normal`}>
                <Link href={`/projects/${p.id}`} className={LINK_CLASS}>
                  {p.display_name}
                </Link>
              </th>
              {BUCKETS.map((b) => {
                const c = cell(p.id, b.key);
                const paid = Number(c?.paid_amount ?? 0);
                const open = Number(c?.open_amount ?? 0);
                return (
                  <Td key={b.key} numeric strong>
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
                  </Td>
                );
              })}
              <Td numeric strong className="font-medium">
                {rowTotal(p.id) ? formatMoney(rowTotal(p.id)) : <span className="font-normal text-muted">—</span>}
                {rowOpen(p.id) ? <span className="ml-1 font-normal text-muted">+{formatMoney(rowOpen(p.id))}</span> : null}
              </Td>
            </Tr>
          ))}
        </tbody>
        <tfoot>
          <Tr total>
            <th scope="row" className={`${TD_CLASS} text-left font-medium`}>
              Σύνολο
            </th>
            {BUCKETS.map((b) => (
              <Td key={b.key} numeric>
                {formatMoney(columnTotal(b.key))}
              </Td>
            ))}
            <Td numeric>{formatMoney(grandTotal)}</Td>
          </Tr>
        </tfoot>
      </SpecTable>
      <p className="max-w-prose text-small text-muted">
        Πληρωμένα ποσά του μήνα· με αχνό, ό,τι είναι ακόμα εκκρεμές ή προγραμματισμένο. Οι λογαριασμοί ΔΕΗ/ΕΥΔΑΠ/internet
        αντιστοιχίζονται αυτόματα στο ακίνητο όταν αναφέρουν αριθμό παροχής από τις Παροχές του έργου.
      </p>
    </div>
  );
}
