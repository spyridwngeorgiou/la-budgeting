import { formatMoney } from "@/lib/format";
import { Button } from "@/components/ui";
import type { MonthCell } from "@/lib/finance/revenuePlan";
import { saveYearAssumptions } from "../actions";

const MONTH_LABELS = ["Ιαν", "Φεβ", "Μαρ", "Απρ", "Μάι", "Ιουν", "Ιουλ", "Αυγ", "Σεπ", "Οκτ", "Νοε", "Δεκ"];

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

  return (
    <form action={saveYearAssumptions.bind(null, planId, roomTypeId, yearNumber)} className="overflow-x-auto">
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr className="text-ink-muted">
            <th className="p-1 text-left">
              Έτος {yearNumber} ({calendarYear})
            </th>
            {MONTH_LABELS.map((m) => (
              <th key={m} className="p-1 text-right whitespace-nowrap">
                {m}
              </th>
            ))}
            <th className="p-1 text-right whitespace-nowrap font-semibold">Σύνολο</th>
          </tr>
        </thead>
        <tbody>
          <tr className="border-t border-line">
            <td className="p-1 text-ink-muted">Πληρότητα %</td>
            {Array.from({ length: 12 }, (_, i) => i + 1).map((month) => (
              <td key={month} className="p-1">
                <input
                  type="number"
                  name={`occ_${month}`}
                  min={0}
                  max={100}
                  step="0.1"
                  defaultValue={Math.round((byMonth.get(month)?.occupancyPct ?? 0) * 1000) / 10}
                  className="w-14 rounded border border-line-strong px-1 py-0.5 text-right"
                />
              </td>
            ))}
            <td />
          </tr>
          <tr className="border-t border-line">
            <td className="p-1 text-ink-muted">ADR (€)</td>
            {Array.from({ length: 12 }, (_, i) => i + 1).map((month) => (
              <td key={month} className="p-1">
                <input
                  type="number"
                  name={`adr_${month}`}
                  min={0}
                  step="0.01"
                  defaultValue={byMonth.get(month)?.adr ?? 0}
                  className="w-16 rounded border border-line-strong px-1 py-0.5 text-right"
                />
              </td>
            ))}
            <td />
          </tr>
          <tr className="border-t border-line text-ink-faint">
            <td className="p-1">Διανυκτ.</td>
            {Array.from({ length: 12 }, (_, i) => i + 1).map((month) => (
              <td key={month} className="p-1 text-right font-mono">
                {byMonth.get(month)?.nightsSold ?? 0}
              </td>
            ))}
            <td className="p-1 text-right font-mono">{months.reduce((s, m) => s + m.nightsSold, 0)}</td>
          </tr>
          <tr className="border-t border-line font-medium">
            <td className="p-1">Έσοδα</td>
            {Array.from({ length: 12 }, (_, i) => i + 1).map((month) => (
              <td key={month} className="p-1 text-right font-mono">
                {formatMoney(byMonth.get(month)?.revenue ?? 0)}
              </td>
            ))}
            <td className="p-1 text-right font-mono">{formatMoney(annualRevenue)}</td>
          </tr>
        </tbody>
      </table>
      <div className="mt-1 flex justify-end">
        <Button type="submit" variant="secondary">
          Αποθήκευση Έτους {yearNumber}
        </Button>
      </div>
    </form>
  );
}
