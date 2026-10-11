import { Button, Term } from "@/components/ui";
import type { MonthCell } from "@/lib/finance/revenuePlan";
import { saveYearAssumptions } from "../actions";

const MONTH_LABELS = ["Ιαν", "Φεβ", "Μαρ", "Απρ", "Μάι", "Ιουν", "Ιουλ", "Αυγ", "Σεπ", "Οκτ", "Νοε", "Δεκ"];
const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);

// No decimals, no currency symbol -- a full formatMoney() value ("1.234,56
// €") is wider than the fixed month columns below can hold, which is what
// pushed every column out of alignment with its header before.
const compactEur = new Intl.NumberFormat("el-GR", { maximumFractionDigits: 0 });

// The P15 spec table with the inputs in its cells; the 12 months ARE the
// columns, so it scrolls inside its frame on a phone.
const TH = "eyebrow border-b border-rule p-1.5 font-medium text-muted";
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
      <div className="overflow-x-auto">
        <table className="w-full table-fixed border-collapse text-small">
          <colgroup>
            <col className="w-28" />
            {MONTHS.map((m) => (
              <col key={m} className="w-[4.75rem]" />
            ))}
            <col className="w-20" />
          </colgroup>
          <thead>
            <tr>
              <th scope="col" className={`${TH} text-left`}>
                Έτος {yearNumber} <span className="num font-normal">({calendarYear})</span>
              </th>
              {MONTH_LABELS.map((m) => (
                <th key={m} scope="col" className={`${TH} text-center`}>
                  {m}
                </th>
              ))}
              <th scope="col" className={`${TH} text-center`}>
                Σύνολο
              </th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row" className="border-b border-hairline p-1.5 text-left font-normal text-text">
                Πληρότητα %
              </th>
              {MONTHS.map((month) => (
                <td key={month} className="border-b border-hairline p-1">
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
                </td>
              ))}
              <td className="border-b border-hairline" />
            </tr>
            <tr>
              <th scope="row" className="border-b border-hairline p-1.5 text-left font-normal text-text">
                <Term title="ADR (Average Daily Rate) — μέση τιμή δωματίου ανά διανυκτέρευση.">ADR</Term> (€)
              </th>
              {MONTHS.map((month) => (
                <td key={month} className="border-b border-hairline p-1">
                  <input
                    type="number"
                    name={`adr_${month}`}
                    aria-label={`ADR ${MONTH_LABELS[month - 1]}`}
                    min={0}
                    step="0.01"
                    defaultValue={byMonth.get(month)?.adr ?? 0}
                    className={INPUT}
                  />
                </td>
              ))}
              <td className="border-b border-hairline" />
            </tr>
            <tr className="text-muted">
              <th scope="row" className="border-b border-hairline p-1.5 text-left font-normal">
                Διανυκτ.
              </th>
              {MONTHS.map((month) => (
                <td key={month} className="num border-b border-hairline p-1.5 text-center">
                  {byMonth.get(month)?.nightsSold ?? 0}
                </td>
              ))}
              <td className="num border-b border-hairline p-1.5 text-center font-medium text-text">{annualNights}</td>
            </tr>
            <tr className="text-ink">
              <th scope="row" className="border-t border-ink p-1.5 text-left font-medium">
                Έσοδα
              </th>
              {MONTHS.map((month) => (
                <td key={month} className="num border-t border-ink p-1.5 text-center">
                  {compactEur.format(byMonth.get(month)?.revenue ?? 0)}€
                </td>
              ))}
              <td className="num border-t border-ink p-1.5 text-center font-medium">{compactEur.format(annualRevenue)}€</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div className="flex justify-end">
        <Button type="submit" variant="secondary" className="max-md:min-h-11">
          Αποθήκευση Έτους {yearNumber}
        </Button>
      </div>
    </form>
  );
}
