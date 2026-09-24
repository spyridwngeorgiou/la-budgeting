import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, Badge } from "@/components/ui";
import { DeleteButton } from "@/components/DeleteButton";
import { formatEuro } from "@/lib/utils";
import { ACCOUNT_TYPE_LABEL, type Account, type Project } from "@/lib/types";
import { AccountFormModal } from "./AccountFormModal";
import { deleteAccount } from "./actions";

export const dynamic = "force-dynamic";

export default async function AccountsPage() {
  const supabase = await createClient();
  const [accRes, projRes, txRes] = await Promise.all([
    supabase.from("accounts").select("*").order("created_at"),
    supabase.from("projects").select("*").order("name"),
    supabase
      .from("transactions")
      .select("id,account_id,type,amount,status")
      .eq("status", "upcoming"),
  ]);
  const accounts = (accRes.data ?? []) as Account[];
  const projects = (projRes.data ?? []) as Project[];
  const upcomingTransactions = (txRes.data ?? []) as Array<{
    id: string;
    account_id: string | null;
    type: "expense" | "income";
    amount: number;
    status: "upcoming";
  }>;
  const num = (n: number | string) => Number(n) || 0;
  const projName = (id: string | null) =>
    projects.find((p) => p.id === id)?.name ?? null;
  const accountById = new Map(accounts.map((a) => [a.id, a] as const));

  // General (not earmarked to a project)
  const available = accounts.filter((a) => !a.is_incoming && !a.project_id);
  const incoming = accounts.filter((a) => a.is_incoming && !a.project_id);
  // Earmarked to a specific project (e.g. a loan)
  const earmarked = accounts.filter((a) => a.project_id);

  const totalAvailable = available.reduce((s, a) => s + num(a.balance), 0);
  const totalIncoming = incoming.reduce((s, a) => s + num(a.balance), 0);

  const upcomingImpactByAccount = new Map<string, number>();
  let sharedPoolUpcomingImpact = 0;

  for (const t of upcomingTransactions) {
    const signed = t.type === "income" ? num(t.amount) : -num(t.amount);

    if (!t.account_id) {
      sharedPoolUpcomingImpact += signed;
      continue;
    }

    const account = accountById.get(t.account_id);
    if (!account || account.project_id || account.is_incoming) continue;

    upcomingImpactByAccount.set(
      t.account_id,
      (upcomingImpactByAccount.get(t.account_id) ?? 0) + signed,
    );
  }

  const impactedAvailableAccounts = available
    .map((a) => {
      const delta = upcomingImpactByAccount.get(a.id) ?? 0;
      return {
        id: a.id,
        name: a.name,
        current: num(a.balance),
        delta,
        projected: num(a.balance) + delta,
      };
    })
    .filter((a) => a.delta !== 0);

  const Row = (a: Account) => (
    <div
      key={a.id}
      className="flex items-center justify-between border-b border-border px-5 py-3 last:border-0"
    >
      <div>
        <p className="font-medium text-foreground">{a.name}</p>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="planned">{ACCOUNT_TYPE_LABEL[a.type]}</Badge>
          {a.project_id && projName(a.project_id) ? (
            <Badge tone="active">Έργο: {projName(a.project_id)}</Badge>
          ) : null}
        </div>
      </div>
      <div className="flex items-center gap-3">
        <span className="text-lg font-semibold">
          {formatEuro(num(a.balance))}
        </span>
        <AccountFormModal account={a} projects={projects} />
        <DeleteButton
          action={deleteAccount}
          id={a.id}
          confirmText="Διαγραφή λογαριασμού;"
        />
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-primary">Λογαριασμοί</h1>
          <p className="text-sm text-muted">
            Διαθέσιμα κεφάλαια και αναμενόμενα έσοδα
          </p>
        </div>
        <AccountFormModal projects={projects} />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Card>
          <CardContent className="pt-5">
            <p className="text-xs font-medium text-muted">Σύνολο διαθέσιμων</p>
            <p className="mt-1 text-2xl font-bold text-primary">
              {formatEuro(totalAvailable)}
            </p>
            <p className="mt-1 text-[11px] text-muted">
              Μεταβολή από επερχόμενα: {formatEuro(sharedPoolUpcomingImpact)} (κοινό σύνολο χωρίς λογαριασμό)
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <p className="text-xs font-medium text-muted">
              Σύνολο αναμενόμενων εσόδων (γενικά)
            </p>
            <p className="mt-1 text-2xl font-bold text-positive">
              {formatEuro(totalIncoming)}
            </p>
          </CardContent>
        </Card>
      </div>

      <div>
        <h2 className="mb-2 text-sm font-semibold text-muted">
          Διαθέσιμα κεφάλαια
        </h2>
        <Card>
          {available.length ? (
            available.map(Row)
          ) : (
            <p className="p-6 text-center text-sm text-muted">
              Δεν υπάρχουν λογαριασμοί ακόμη.
            </p>
          )}
        </Card>
      </div>

      {incoming.length > 0 && (
        <div>
          <h2 className="mb-2 text-sm font-semibold text-muted">
            Αναμενόμενα έσοδα (γενικά)
          </h2>
          <Card>{incoming.map(Row)}</Card>
        </div>
      )}

      <div>
        <h2 className="mb-2 text-sm font-semibold text-muted">
          Λογαριασμοί με μεταβολή διαθέσιμου (από επερχόμενα)
        </h2>
        <Card>
          {impactedAvailableAccounts.length ? (
            <div className="divide-y divide-border">
              {impactedAvailableAccounts.map((a) => (
                <div key={a.id} className="flex items-center justify-between px-5 py-3 text-sm">
                  <div>
                    <p className="font-medium text-foreground">{a.name}</p>
                    <p className="text-xs text-muted">
                      Τώρα: {formatEuro(a.current)} · Μεταβολή: {a.delta >= 0 ? "+" : ""}
                      {formatEuro(a.delta)}
                    </p>
                  </div>
                  <span className="font-semibold text-primary">
                    Προβολή: {formatEuro(a.projected)}
                  </span>
                </div>
              ))}
              <div className="px-5 py-3 text-xs text-muted">
                Κοινό σύνολο χωρίς λογαριασμό: {sharedPoolUpcomingImpact >= 0 ? "+" : ""}
                {formatEuro(sharedPoolUpcomingImpact)}
              </div>
            </div>
          ) : (
            <p className="p-6 text-center text-sm text-muted">
              Δεν υπάρχουν επερχόμενες κινήσεις που να αλλάζουν διαθέσιμους λογαριασμούς.
            </p>
          )}
        </Card>
      </div>

      {earmarked.length > 0 && (
        <div>
          <h2 className="mb-2 text-sm font-semibold text-muted">
            Δεσμευμένη χρηματοδότηση έργων (εκτός γενικών συνόλων)
          </h2>
          <Card>{earmarked.map(Row)}</Card>
        </div>
      )}
    </div>
  );
}
