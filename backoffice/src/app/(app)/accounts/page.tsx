import { createClient } from "@/lib/supabase/server";
import { formatMoney, formatDate } from "@/lib/format";
import { el } from "@/lib/i18n/el";
import { Badge } from "@/components/ui";
import { AccountFormModal } from "./AccountFormModal";
import { createAccount } from "./actions";
import { BalanceAssertion, type LatestAssertion } from "./BalanceAssertion";

export default async function AccountsPage() {
  const supabase = await createClient();
  const [{ data: accounts }, { data: assertions }] = await Promise.all([
    supabase.from("v_account_balances").select("*").order("owner_scope").order("name"),
    // Latest first so the per-account reduce below only ever keeps the most
    // recent row it sees.
    supabase
      .from("account_balance_assertions")
      .select("account_id, as_of_date, asserted_balance, computed_balance")
      .order("as_of_date", { ascending: false }),
  ]);
  const latestAssertionByAccount = new Map<string, LatestAssertion>();
  for (const row of assertions ?? []) {
    if (!latestAssertionByAccount.has(row.account_id)) {
      latestAssertionByAccount.set(row.account_id, row);
    }
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
          <div className="rounded border border-ink bg-ink p-4 text-white">
            <div className="text-xs text-white/70">Σύνολο Ρευστών Διαθεσίμων</div>
            <div className="font-mono text-2xl">{formatMoney(totalLiquid)}</div>
          </div>

          {[
            { title: el.account.ownerValues.corporate, rows: corporate },
            { title: el.account.ownerValues.personal, rows: personal },
          ]
            .filter((group) => group.rows.length > 0)
            .map((group) => (
              <section key={group.title}>
                <h2 className="mb-2 text-sm font-medium text-ink-muted">{group.title}</h2>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {group.rows.map((a) => (
                    <div key={a.account_id} className="rounded border border-line p-3">
                      <div className="mb-1 flex items-center justify-between">
                        <span className="text-sm font-medium">{a.name}</span>
                        {!a.is_liquid && <Badge tone="amber">μη ρευστό</Badge>}
                      </div>
                      <div className="font-mono text-lg">{formatMoney(a.current_balance)}</div>
                      <div className="text-xs text-ink-muted">
                        Έναρξη {formatDate(a.opening_balance_date)}: {formatMoney(a.opening_balance)}
                      </div>
                      <BalanceAssertion
                        accountId={a.account_id!}
                        latest={latestAssertionByAccount.get(a.account_id!) ?? null}
                      />
                    </div>
                  ))}
                </div>
              </section>
            ))}
        </>
      )}
    </div>
  );
}
