import { createClient } from "@/lib/supabase/server";
import { formatMoney, formatDate } from "@/lib/format";
import { el } from "@/lib/i18n/el";
import { Badge } from "@/components/ui";
import { AccountFormModal } from "./AccountFormModal";
import { createAccount } from "./actions";

export default async function AccountsPage() {
  const supabase = await createClient();
  const { data: accounts } = await supabase
    .from("v_account_balances")
    .select("*")
    .order("owner_scope")
    .order("name");

  const corporate = (accounts ?? []).filter((a) => a.owner_scope === "corporate");
  const personal = (accounts ?? []).filter((a) => a.owner_scope === "personal");
  const totalLiquid = (accounts ?? [])
    .filter((a) => a.is_liquid)
    .reduce((sum, a) => sum + Number(a.current_balance ?? 0), 0);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">{el.nav.accounts}</h1>
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
