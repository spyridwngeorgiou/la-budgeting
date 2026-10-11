import { Button, SpecTable, TD_CLASS, Td, Term, Th, Tr } from "@/components/ui";
import type { MonthCell } from "@/lib/finance/revenuePlan";
import { saveYearAssumptions } from "../actions";

const MONTH_LABELS = ["Ιαν", "Φεβ", "Μαρ", "Απρ", "Μάι", "Ιουν", "Ιουλ", "Αυγ", "Σεπ", "Οκτ", "Νοε", "Δεκ"];
const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);

// No decimals, no currency symbol -- a full formatMoney() value ("1.234,56
// €") is wider than the fixed month columns below can hold, which is what
// pushed every column out of alignment with its header before.
const compactEur = new Intl.NumberFormat("el-GR", { maximumFractionDigits: 0 });

// The P15 spec table with the inputs in its cells; the 12 months ARE the
// columns, so it scrolls inside its frame on a phone. Cells keep the grid's
// tight padding (p-1.5 / p-1, important over the spec padding) so the
// inputs fit the fixed month columns.
const INPUT =
  "num min-h-9 w-full border border-field-border bg-field px-1 py-1 text-center text-ink focus:border-navy focus:outline-none";

export function YearTable({
  planId,
  roomTypeId,
  yearNumber,
  calendarYear,
  months,
}: {
  planId: string;
  roomTypeId: string;
  yearNumber: number;
  calendarYear: number;
  months: MonthCell[];
}) {
  const byMonth = new Map(months.map((m) => [m.monthNumber, m]));
  const annualRevenue = months.reduce((s, m) => s + m.revenue, 0);
  const annualNights = months.reduce((s, m) => s + m.nightsSold, 0);

  return (
    <form action={saveYearAssumptions.bind(null, planId, roomTypeId, yearNumber)} className="flex flex-col gap-3">
      <SpecTable label={`Έτος ${yearNumber} (${calendarYear})`} tableClassName="table-fixed text-small">
          <colgroup>
            <col className="w-28" />
            {MONTHS.map((m) => (
              <col key={m} className="w-[4.75rem]" />
            ))}
            <col className="w-20" />
          </colgroup>
          <thead>
            <tr>
              <Th className="p-1.5!">
                Έτος {yearNumber} <span className="num font-normal">({calendarYear})</span>
              </Th>
              {MONTH_LABELS.map((m) => (
                <Th key={m} className="p-1.5! text-center">
                  {m}
                </Th>
              ))}
              <Th className="p-1.5! text-center">Σύνολο</Th>
            </tr>
          </thead>
          <tbody>
            <Tr>
              <th scope="row" className={`${TD_CLASS} p-1.5! text-left font-normal`}>
                Πληρότητα %
              </th>
              {MONTHS.map((month) => (
                <Td key={month} className="p-1!">
                  <input
                    type="number"
                    name={`occ_${month}`}
                    aria-label={`Πληρότητα % ${MONTH_LABELS[month - 1]}`}
                    min={0}
                    max={100}
                    step="0.1"
                    defaultValue={Math.round((byMonth.get(month)?.occupancyPct ?? 0) * 1000) / 10}
                    className={INPUT}
                  />
                </Td>
              ))}
              <Td className="p-1.5!" />
            </Tr>
            <Tr>
              <th scope="row" className={`${TD_CLASS} p-1.5! text-left font-normal`}>
                <Term title="ADR (Average Daily Rate) — μέση τιμή δωματίου ανά διανυκτέρευση.">ADR</Term> (€)
              </th>
              {MONTHS.map((month) => (
                <Td key={month} className="p-1!">
                  <input
                    type="number"
                    name={`adr_${month}`}
                    aria-label={`ADR ${MONTH_LABELS[month - 1]}`}
                    min={0}
                    step="0.01"
                    defaultValue={byMonth.get(month)?.adr ?? 0}
                    className={INPUT}
                  />
                </Td>
              ))}
              <Td className="p-1.5!" />
            </Tr>
            <Tr>
              <th scope="row" className={`${TD_CLASS} p-1.5! text-left font-normal text-muted`}>
                Διανυκτ.
              </th>
              {MONTHS.map((month) => (
                <Td key={month} className="num p-1.5! text-center text-muted">
                  {byMonth.get(month)?.nightsSold ?? 0}
                </Td>
              ))}
              <Td className="num p-1.5! text-center font-medium">{annualNights}</Td>
            </Tr>
            <Tr total>
              <th scope="row" className={`${TD_CLASS} p-1.5! text-left font-medium`}>
                Έσοδα
              </th>
              {MONTHS.map((month) => (
                <Td key={month} className="num p-1.5! text-center font-normal!">
                  {compactEur.format(byMonth.get(month)?.revenue ?? 0)}€
                </Td>
              ))}
              <Td className="num p-1.5! text-center">{compactEur.format(annualRevenue)}€</Td>
            </Tr>
          </tbody>
      </SpecTable>
      <div className="flex justify-end">
        <Button type="submit" variant="secondary">
          Αποθήκευση Έτους {yearNumber}
        </Button>
      </div>
    </form>
  );
}
