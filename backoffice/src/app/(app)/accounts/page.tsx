import { createClient } from "@/lib/supabase/server";
import { formatMoney, formatDate } from "@/lib/format";
import { el } from "@/lib/i18n/el";
import { Badge, Card } from "@/components/ui";
import { AccountFormModal } from "./AccountFormModal";
import { createAccount } from "./actions";
import { BalanceAssertion, type BalanceCheck } from "./BalanceAssertion";

export default async function AccountsPage() {
  const supabase = await createClient();
  const [{ data: accounts }, { data: checkRows }] = await Promise.all([
    supabase.from("v_account_balances").select("*").order("owner_scope").order("name"),
    // Newest first per account; each row carries its live period breakdown (0035).
    supabase.from("v_balance_checks").select("*").order("as_of_date", { ascending: false }),
  ]);
  const checksByAccount = new Map<string, BalanceCheck[]>();
  for (const r of checkRows ?? []) {
    const list = checksByAccount.get(r.account_id!) ?? [];
    list.push({
      id: r.id!,
      as_of_date: r.as_of_date!,
      asserted_balance: Number(r.asserted_balance),
      from_import: Boolean(r.from_import),
      period_start: r.period_start!,
      period_start_balance: Number(r.period_start_balance),
      period_start_source: r.period_start_source as BalanceCheck["period_start_source"],
      period_income: Number(r.period_income),
      period_income_n: Number(r.period_income_n),
      period_expense: Number(r.period_expense),
      period_expense_n: Number(r.period_expense_n),
      expected_balance: Number(r.expected_balance),
      period_gap: Number(r.period_gap),
      total_gap: Number(r.total_gap),
    });
    checksByAccount.set(r.account_id!, list);
  }

  const corporate = (accounts ?? []).filter((a) => a.owner_scope === "corporate");
  const personal = (accounts ?? []).filter((a) => a.owner_scope === "personal");
  const totalLiquid = (accounts ?? [])
    .filter((a) => a.is_liquid)
    .reduce((sum, a) => sum + Number(a.current_balance ?? 0), 0);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">{el.nav.accounts}</h1>
          <p className="mt-1 text-sm text-ink-muted">
            Τράπεζες, μετρητά και μη ρευστά περιουσιακά στοιχεία, εταιρικά και προσωπικά, με τρέχον υπόλοιπο.
          </p>
        </div>
        <AccountFormModal action={createAccount} />
      </div>

      {(accounts ?? []).length === 0 ? (
        <p className="p-6 text-center text-sm text-ink-muted">
          Δεν υπάρχουν ακόμα λογαριασμοί. Πατήστε «+ Νέος Λογαριασμός» για να ξεκινήσετε.
        </p>
      ) : (
        <>
          <div className="rounded-lg border border-ink bg-ink p-4 text-white">
            <div className="text-xs text-white/70">Σύνολο Ρευστών Διαθεσίμων</div>
            <div className="font-mono text-2xl font-semibold tabular-nums">{formatMoney(totalLiquid)}</div>
          </div>

          {[
            { title: el.account.ownerValues.corporate, rows: corporate },
            { title: el.account.ownerValues.personal, rows: personal },
          ]
            .filter((group) => group.rows.length > 0)
            .map((group) => (
              <section key={group.title}>
                <h2 className="mb-2 text-sm font-medium text-ink-muted">{group.title}</h2>
                <div className="grid grid-cols-1 items-start gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {group.rows.map((a) => (
                    <Card key={a.account_id} className="shadow-sm">
                      <div className="mb-1.5 flex items-center justify-between">
                        <span className="text-sm font-medium text-ink">{a.name}</span>
                        {!a.is_liquid && <Badge tone="amber">μη ρευστό</Badge>}
                      </div>
                      <div className="font-mono text-2xl font-semibold tabular-nums text-ink">{formatMoney(a.current_balance)}</div>
                      <div className="mt-0.5 text-xs text-ink-faint">
                        Έναρξη {formatDate(a.opening_balance_date)}: {formatMoney(a.opening_balance)}
                      </div>
                      <BalanceAssertion
                        accountId={a.account_id!}
                        checks={checksByAccount.get(a.account_id!) ?? []}
                        expectedToday={Number(a.current_balance ?? 0)}
                        defaultFrom={checksByAccount.get(a.account_id!)?.[0]?.as_of_date ?? a.opening_balance_date ?? ""}
                        isCash={a.kind === "cash"}
                      />
                    </Card>
                  ))}
                </div>
              </section>
            ))}
        </>
      )}
    </div>
  );
}
