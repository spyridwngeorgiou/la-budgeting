import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui";
import { BarChartCard } from "@/components/Charts";
import { formatDate, formatEuro } from "@/lib/utils";
import type {
  Account,
  Transaction,
  Project,
  Category,
  Contact,
} from "@/lib/types";
import { TransactionFormModal } from "../transactions/TransactionFormModal";

export const dynamic = "force-dynamic";

function StatCard({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: number;
  tone?: "default" | "positive" | "negative" | "primary";
}) {
  const toneClass = {
    default: "text-foreground",
    positive: "text-positive",
    negative: "text-negative",
    primary: "text-primary",
  }[tone];

  return (
    <Card>
      <CardContent className="pt-5">
        <p className="text-xs font-medium text-muted">{label}</p>
        <p className={`mt-1 text-2xl font-bold ${toneClass}`}>{formatEuro(value)}</p>
      </CardContent>
    </Card>
  );
}

export default async function DashboardPage() {
  const supabase = await createClient();

  const [accountsRes, txRes, projectsRes, categoriesRes, contactsRes] =
    await Promise.all([
      supabase.from("accounts").select("*"),
      supabase.from("transactions").select("*").order("tx_date", { ascending: false }),
      supabase.from("projects").select("*"),
      supabase.from("categories").select("*"),
      supabase.from("contacts").select("*").order("name"),
    ]);

  const accounts = (accountsRes.data ?? []) as Account[];
  const transactions = (txRes.data ?? []) as Transaction[];
  const projects = (projectsRes.data ?? []) as Project[];
  const categories = (categoriesRes.data ?? []) as Category[];
  const contacts = (contactsRes.data ?? []) as Contact[];

  const num = (n: number | string | null) => Number(n) || 0;
  const accountById = new Map(accounts.map((a) => [a.id, a] as const));

  // Transactions without account_id are treated as using the common general pool.
  const usesGeneralPool = (t: Transaction) => {
    if (!t.account_id) return true;
    const account = accountById.get(t.account_id);
    if (!account) return true;
    return !account.project_id;
  };

  const availableTotal = accounts
    .filter((a) => !a.is_incoming && !a.project_id)
    .reduce((s, a) => s + num(a.balance), 0);

  const incomingAccountsTotal = accounts
    .filter((a) => a.is_incoming && !a.project_id)
    .reduce((s, a) => s + num(a.balance), 0);

  const upcomingExpenses = transactions
    .filter((t) => t.type === "expense" && t.status === "upcoming" && usesGeneralPool(t))
    .reduce((s, t) => s + num(t.amount), 0);

  const upcomingIncome = transactions
    .filter((t) => t.type === "income" && t.status === "upcoming" && usesGeneralPool(t))
    .reduce((s, t) => s + num(t.amount), 0);

  const netNow = availableTotal - upcomingExpenses;
  const projectedNet =
    availableTotal + incomingAccountsTotal + upcomingIncome - upcomingExpenses;

  const vatPayable = transactions
    .filter((t) => t.vat_status === "payable")
    .reduce((s, t) => s + num(t.vat_amount), 0);
  const vatCredit = transactions
    .filter((t) => t.vat_status === "credit")
    .reduce((s, t) => s + num(t.vat_amount), 0);
  const vatNet = vatPayable - vatCredit;

  const projectName = (id: string | null) =>
    projects.find((p) => p.id === id)?.name ?? "Χωρίς έργο";

  const byProjectMap = new Map<string, { id: string | null; value: number }>();
  for (const t of transactions) {
    if (t.type !== "expense") continue;
    const key = projectName(t.project_id);
    const cur = byProjectMap.get(key) ?? { id: t.project_id, value: 0 };
    cur.value += num(t.amount);
    byProjectMap.set(key, cur);
  }

  const byProjectFull = [...byProjectMap.entries()]
    .map(([name, v]) => ({ name, id: v.id, value: v.value }))
    .sort((a, b) => b.value - a.value);

  const byProjectChart = byProjectFull.map((p) => ({ name: p.name, value: p.value }));

  const upcomingRows = transactions
    .filter((t) => t.status === "upcoming")
    .slice(0, 6);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-primary">Επισκόπηση</h1>
          <p className="text-sm text-muted">Απλή εικόνα ρευστότητας και κινήσεων</p>
        </div>
        <TransactionFormModal
          projects={projects}
          accounts={accounts}
          categories={categories}
          contacts={contacts}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Διαθέσιμα" value={availableTotal} tone="primary" />
        <StatCard label="Επερχόμενα έξοδα" value={upcomingExpenses} tone="negative" />
        <StatCard label="Επερχόμενα έσοδα" value={upcomingIncome} tone="positive" />
        <StatCard
          label="Καθαρό υπόλοιπο τώρα"
          value={netNow}
          tone={netNow >= 0 ? "positive" : "negative"}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Έξοδα ανά έργο</CardTitle>
          </CardHeader>
          <CardContent>
            <BarChartCard data={byProjectChart} />
            <ul className="mt-2 divide-y divide-border text-sm">
              {byProjectFull.map((p) => (
                <li key={p.name} className="flex items-center justify-between py-1.5">
                  <span>{p.name}</span>
                  <span className="font-medium">{formatEuro(p.value)}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Σημείωση ρευστότητας</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted">
              Τα ποσά στους λογαριασμούς θεωρούνται τα τρέχοντα διαθέσιμα τώρα. Η επίδραση από εδώ και πέρα παρακολουθείται από τις επερχόμενες κινήσεις.
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Θέση ΦΠΑ</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="rounded-lg border border-border p-3">
                <p className="text-xs text-muted">Οφειλόμενο</p>
                <p className="text-lg font-semibold text-negative">{formatEuro(vatPayable)}</p>
              </div>
              <div className="rounded-lg border border-border p-3">
                <p className="text-xs text-muted">Πιστωτικό</p>
                <p className="text-lg font-semibold text-positive">{formatEuro(vatCredit)}</p>
              </div>
              <div className="rounded-lg border border-border p-3">
                <p className="text-xs text-muted">Καθαρή θέση</p>
                <p className={`text-lg font-semibold ${vatNet >= 0 ? "text-negative" : "text-positive"}`}>
                  {formatEuro(vatNet)}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Επόμενες κινήσεις</CardTitle>
          </CardHeader>
          <CardContent>
            {upcomingRows.length === 0 ? (
              <p className="text-sm text-muted">Δεν υπάρχουν επερχόμενες κινήσεις.</p>
            ) : (
              <ul className="divide-y divide-border">
                {upcomingRows.map((t) => (
                  <li key={t.id} className="flex items-center justify-between py-2 text-sm">
                    <div>
                      <p className="font-medium">{t.notes || "Κίνηση"}</p>
                      <p className="text-xs text-muted">
                        {projectName(t.project_id)} · {formatDate(t.tx_date)}
                      </p>
                    </div>
                    <span className={t.type === "income" ? "font-semibold text-positive" : "font-semibold"}>
                      {t.type === "income" ? "+" : "−"}
                      {formatEuro(num(t.amount))}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-3 text-xs text-muted">
              Προβλεπόμενο υπόλοιπο με αναμενόμενα: {formatEuro(projectedNet)}
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
