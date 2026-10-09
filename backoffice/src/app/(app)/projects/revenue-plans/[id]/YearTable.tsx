import { Button, Term } from "@/components/ui";
import type { MonthCell } from "@/lib/finance/revenuePlan";
import { saveYearAssumptions } from "../actions";

const MONTH_LABELS = ["Ιαν", "Φεβ", "Μαρ", "Απρ", "Μάι", "Ιουν", "Ιουλ", "Αυγ", "Σεπ", "Οκτ", "Νοε", "Δεκ"];
const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);

// No decimals, no currency symbol -- a full formatMoney() value ("1.234,56
// €") is wider than the fixed month columns below can hold, which is what
// pushed every column out of alignment with its header before.
const compactEur = new Intl.NumberFormat("el-GR", { maximumFractionDigits: 0 });

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
    <form action={saveYearAssumptions.bind(null, planId, roomTypeId, yearNumber)} className="overflow-x-auto rounded-md border border-line">
      <table className="w-full table-fixed border-collapse text-xs">
        <colgroup>
          <col className="w-28" />
          {MONTHS.map((m) => (
            <col key={m} className="w-[4.75rem]" />
          ))}
          <col className="w-20" />
        </colgroup>
        <thead>
          <tr className="border-b border-line bg-bg text-ink-muted">
            <th className="p-1.5 text-left font-medium">
              Έτος {yearNumber} <span className="font-normal text-ink-faint">({calendarYear})</span>
            </th>
            {MONTH_LABELS.map((m) => (
              <th key={m} className="p-1.5 text-center font-medium">
                {m}
              </th>
            ))}
            <th className="p-1.5 text-center font-semibold">Σύνολο</th>
          </tr>
        </thead>
        <tbody>
          <tr className="border-b border-line">
            <td className="p-1.5 text-ink-muted">Πληρότητα %</td>
            {MONTHS.map((month) => (
              <td key={month} className="p-1">
                <input
                  type="number"
                  name={`occ_${month}`}
                  min={0}
                  max={100}
                  step="0.1"
                  defaultValue={Math.round((byMonth.get(month)?.occupancyPct ?? 0) * 1000) / 10}
                  className="w-full rounded-md border border-line-strong px-1 py-1 text-center tabular-nums"
                />
              </td>
            ))}
            <td />
          </tr>
          <tr className="border-b border-line">
            <td className="p-1.5 text-ink-muted">
              <Term title="ADR (Average Daily Rate) — μέση τιμή δωματίου ανά διανυκτέρευση.">ADR</Term> (€)
            </td>
            {MONTHS.map((month) => (
              <td key={month} className="p-1">
                <input
                  type="number"
                  name={`adr_${month}`}
                  min={0}
                  step="0.01"
                  defaultValue={byMonth.get(month)?.adr ?? 0}
                  className="w-full rounded-md border border-line-strong px-1 py-1 text-center tabular-nums"
                />
              </td>
            ))}
            <td />
          </tr>
          <tr className="border-b border-line text-ink-faint">
            <td className="p-1.5">Διανυκτ.</td>
            {MONTHS.map((month) => (
              <td key={month} className="p-1.5 text-center tabular-nums">
                {byMonth.get(month)?.nightsSold ?? 0}
              </td>
            ))}
            <td className="p-1.5 text-center font-medium tabular-nums">{annualNights}</td>
          </tr>
          <tr className="bg-bg font-medium">
            <td className="p-1.5">Έσοδα</td>
            {MONTHS.map((month) => (
              <td key={month} className="p-1.5 text-center tabular-nums">
                {compactEur.format(byMonth.get(month)?.revenue ?? 0)}€
              </td>
            ))}
            <td className="p-1.5 text-center tabular-nums">{compactEur.format(annualRevenue)}€</td>
          </tr>
        </tbody>
      </table>
      <div className="flex justify-end border-t border-line bg-surface p-2">
        <Button type="submit" variant="secondary">
          Αποθήκευση Έτους {yearNumber}
        </Button>
      </div>
    </form>
  );
}
