import { createClient } from "@/lib/supabase/server";
import { getCurrentOrg } from "@/lib/supabase/org";
import { formatMoney } from "@/lib/format";
import { Badge, Card } from "@/components/ui";
import { CashflowChart } from "./CashflowChart";

function monthLabel(monthKey: string) {
  const [y, m] = monthKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("el-GR", {
    month: "short",
    year: "2-digit",
    timeZone: "UTC",
  });
}

function addMonths(monthKey: string, delta: number): string {
  const [y, m] = monthKey.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

// How far ahead the runway always reaches from today, regardless of whether
// any transaction is dated out there yet -- otherwise the page's horizon
// silently stops wherever the data happens to end, instead of always
// looking a fixed distance ahead of "now".
const FORWARD_HORIZON_MONTHS = 6;

export default async function CashflowPage() {
  const supabase = await createClient();

  const [{ data: monthly }, { data: accounts }, org] = await Promise.all([
    supabase.from("v_cashflow_monthly").select("*").order("month"),
    supabase.from("v_account_balances").select("current_balance"),
    getCurrentOrg(supabase),
  ]);

  const buffer = Number((org.settings as Record<string, unknown>)?.min_cash_buffer ?? 50000);
  const currentLiquid = (accounts ?? []).reduce((s, a) => s + Number(a.current_balance ?? 0), 0);

  const byMonth = new Map<string, { inflow: number; outflow: number; weighted: number }>();
  for (const row of monthly ?? []) {
    // row.month comes back as a full date ("2026-09-01"), not "2026-09" --
    // truncate so it actually matches todayMonth/addMonths keys below.
    // Before this, "today" never matched a real data row and always showed
    // as a separate, empty phantom entry next to the real one.
    const key = row.month!.slice(0, 7);
    const existing = byMonth.get(key) ?? { inflow: 0, outflow: 0, weighted: 0 };
    existing.inflow += Number(row.inflow ?? 0);
    existing.outflow += Number(row.outflow ?? 0);
    existing.weighted += Number(row.weighted_expected_inflow ?? 0);
    byMonth.set(key, existing);
  }

  const todayMonth = new Date().toISOString().slice(0, 7);
  // The runway always reaches from today to today+FORWARD_HORIZON_MONTHS,
  // computed fresh on every request -- so the page keeps pace with "now" on
  // its own, without ever needing a manual date bump.
  for (let i = 0; i <= FORWARD_HORIZON_MONTHS; i++) {
    const key = addMonths(todayMonth, i);
    if (!byMonth.has(key)) byMonth.set(key, { inflow: 0, outflow: 0, weighted: 0 });
  }

  const months = [...byMonth.keys()].sort();
  // Anchored to today's real liquidity, not zero -- the whole point of a
  // running total is "where does this leave the actual bank balance", and
  // starting from 0 made every cumulative figure before this a fiction.
  // Past months (already reflected in current_balance) walk forward from
  // today's balance minus their own net, so the column reads as real
  // balances throughout, not just from today onward.
  const todayIndex = months.indexOf(todayMonth);
  const runningByMonth = new Map<string, number>();
  let running = currentLiquid;
  for (let i = todayIndex; i < months.length; i++) {
    if (i > todayIndex) running += byMonth.get(months[i])!.inflow - byMonth.get(months[i])!.outflow;
    runningByMonth.set(months[i], running);
  }
  running = currentLiquid;
  for (let i = todayIndex - 1; i >= 0; i--) {
    runningByMonth.set(months[i], running);
    running -= byMonth.get(months[i])!.inflow - byMonth.get(months[i])!.outflow;
  }

  const chartRows = months.map((month) => {
    const m = byMonth.get(month)!;
    return {
      month,
      label: monthLabel(month),
      inflow: m.inflow,
      outflow: m.outflow,
      weighted: m.weighted,
      running: runningByMonth.get(month) ?? 0,
      isToday: month === todayMonth,
    };
  });

  const firstShortfall = chartRows.find((r) => r.month >= todayMonth && r.running < buffer);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Ταμείο — Ρευστότητα</h1>
      <p className="text-sm text-ink-muted">
        Προγραμματισμένες κινήσεις δεν προσμετρώνται στις εισροές/εκροές (πραγματική ταμειακή ροή,
        όχι δεσμευμένο budget). Το σωρευτικό ταμείο ξεκινά από το πραγματικό τρέχον υπόλοιπο
        λογαριασμών.
      </p>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Card>
          <div className="text-xs text-ink-muted">Τρέχον Ταμείο (σήμερα)</div>
          <div className="font-mono text-lg">{formatMoney(currentLiquid)}</div>
        </Card>
        <Card>
          <div className="text-xs text-ink-muted">Απόθεμα Ασφαλείας</div>
          <div className="font-mono text-lg">{formatMoney(buffer)}</div>
        </Card>
        <Card className={firstShortfall ? "border-red-ink/40 bg-red-bg" : undefined}>
          <div className="text-xs text-ink-muted">Πρώτος Μήνας Κάτω από Απόθεμα</div>
          <div className={`font-mono text-lg ${firstShortfall ? "text-red-ink" : ""}`}>
            {firstShortfall ? firstShortfall.label : "— κανένας προβλεπόμενος —"}
          </div>
        </Card>
      </div>

      <CashflowChart rows={chartRows} buffer={buffer} />

      <div className="overflow-x-auto rounded-lg border border-line">
        <table className="w-full text-left text-sm">
          <thead className="bg-bg text-ink-muted">
            <tr>
              <th className="p-2">Μήνας</th>
              <th className="hidden p-2 text-right sm:table-cell">Εισροές</th>
              <th className="hidden p-2 text-right sm:table-cell">Εκροές</th>
              <th className="p-2 text-right">Καθαρό</th>
              <th className="p-2 text-right">Σωρευτικό Ταμείο</th>
              <th className="p-2"></th>
            </tr>
          </thead>
          <tbody>
            {chartRows.map((r) => {
              const m = byMonth.get(r.month)!;
              const net = m.inflow - m.outflow;
              const belowBuffer = r.running < buffer;
              return (
                <tr key={r.month} className={`border-t border-line ${r.isToday ? "bg-sage/40" : ""}`}>
                  <td className="p-2">
                    {r.label}
                    {r.isToday && <span className="ml-1.5 text-xs text-sage-ink">σήμερα</span>}
                  </td>
                  <td className="p-2 text-right font-mono text-sage-ink">
                    {formatMoney(m.inflow)}
                    {r.month >= todayMonth && m.weighted > 0 && (
                      <div className="text-[10px] font-normal text-ink-faint">
                        + {formatMoney(m.weighted)} αναμενόμενα (σταθμισμένα)
                      </div>
                    )}
                  </td>
                  <td className="p-2 text-right font-mono">{formatMoney(m.outflow)}</td>
                  <td className={`p-2 text-right font-mono ${net < 0 ? "text-red-ink" : ""}`}>
                    {formatMoney(net)}
                  </td>
                  <td className="p-2 text-right font-mono font-medium">{formatMoney(r.running)}</td>
                  <td className="p-2">{belowBuffer && <Badge tone="red">κάτω από απόθεμα</Badge>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
