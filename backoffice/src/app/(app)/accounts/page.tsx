import { createClient } from "@/lib/supabase/server";
import { getCurrentOrgId } from "@/lib/supabase/org";
import { formatMoney } from "@/lib/format";
import { todayAthens } from "@/lib/dates";
import { el } from "@/lib/i18n/el";
import type { AccountKind } from "@/lib/domain/enums";
import { EmptyState, PageHeader, Stat } from "@/components/ui";
import { AccountFormModal } from "./AccountFormModal";
import { createAccount } from "./actions";
import { AccountsTable, type AccountListRow } from "./AccountsTable";
import { okGap, type AccountStatus } from "./status";

export default async function AccountsPage() {
  const supabase = await createClient();
  const orgId = await getCurrentOrgId(supabase);
  const [{ data: accounts }, { data: checkRows }] = await Promise.all([
    supabase.from("v_account_balances").select("*").eq("org_id", orgId).order("owner_scope").order("name"),
    // Newest first: the first row per account is its latest check (0035).
    supabase
      .from("v_balance_checks")
      .select("account_id, as_of_date, total_gap")
      .eq("org_id", orgId)
      .order("as_of_date", { ascending: false }),
  ]);
  const latestCheck = new Map<string, { as_of_date: string; total_gap: number }>();
  for (const r of checkRows ?? []) {
    if (!latestCheck.has(r.account_id!)) latestCheck.set(r.account_id!, { as_of_date: r.as_of_date!, total_gap: Number(r.total_gap) });
  }

  const rows: (AccountListRow & { owner_scope: string | null })[] = (accounts ?? []).map((a) => {
    const check = latestCheck.get(a.account_id!);
    const status: AccountStatus = !check ? "never_counted" : okGap(check.total_gap) ? "ok" : "drift";
    return {
      account_id: a.account_id!,
      name: a.name!,
      kind: a.kind! as AccountKind,
      is_liquid: Boolean(a.is_liquid),
      current_balance: Number(a.current_balance ?? 0),
      status,
      last_check: check?.as_of_date ?? null,
      owner_scope: a.owner_scope,
    };
  });
  const totalLiquid = rows.filter((a) => a.is_liquid).reduce((sum, a) => sum + a.current_balance, 0);
  const today = todayAthens();

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title={el.nav.accounts}
        meta="Τράπεζες, μετρητά και μη ρευστά περιουσιακά στοιχεία, εταιρικά και προσωπικά, με τρέχον υπόλοιπο."
        actions={<AccountFormModal action={createAccount} />}
      />

      {rows.length === 0 ? (
        <EmptyState title="Δεν υπάρχουν ακόμα λογαριασμοί. Πατήστε «+ Νέος Λογαριασμός» για να ξεκινήσετε." />
      ) : (
        <>
          <Stat size="lg" label={el.account.totalLiquid} value={formatMoney(totalLiquid)} />

          {(["corporate", "personal"] as const)
            .map((scope) => ({ scope, rows: rows.filter((a) => a.owner_scope === scope) }))
            .filter((group) => group.rows.length > 0)
            .map((group) => (
              <section key={group.scope} className="flex flex-col gap-2">
                <h2 className="eyebrow text-muted">{el.account.groups[group.scope]}</h2>
                <AccountsTable accounts={group.rows} today={today} />
              </section>
            ))}
        </>
      )}
    </div>
  );
}
