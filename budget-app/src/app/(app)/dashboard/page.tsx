import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui";
import { BarChartCard, PieChartCard, ChartLegend } from "@/components/Charts";
import { formatEuro } from "@/lib/utils";
import type { Account, Transaction, Project, Category } from "@/lib/types";

export const dynamic = "force-dynamic";

function StatCard({
  label,
  value,
  tone = "default",
  hint,
  href,
}: {
  label: string;
  value: number;
  tone?: "default" | "positive" | "negative" | "primary";
  hint?: string;
  href?: string;
}) {
  const toneClass = {
    default: "text-foreground",
    positive: "text-positive",
    negative: "text-negative",
    primary: "text-primary",
  }[tone];

  const inner = (
    <CardContent className="pt-5">
      <p className="flex items-center justify-between text-xs font-medium text-muted">
        {label}
        {href ? <ArrowUpRight size={14} className="text-muted/70" /> : null}
      </p>
      <p className={`mt-1 text-2xl font-bold ${toneClass}`}>
        {formatEuro(value)}
      </p>
      {hint ? <p className="mt-1 text-[11px] text-muted">{hint}</p> : null}
    </CardContent>
  );

  if (href) {
    return (
      <Card className="transition hover:border-primary/40 hover:shadow-md">
        <Link href={href} className="block">
          {inner}
        </Link>
      </Card>
    );
  }
  return <Card>{inner}</Card>;
}

export default async function DashboardPage() {
  const supabase = await createClient();

  const [accountsRes, txRes, projectsRes, categoriesRes] = await Promise.all([
    supabase.from("accounts").select("*"),
    supabase.from("transactions").select("*"),
    supabase.from("projects").select("*"),
    supabase.from("categories").select("*"),
  ]);

  const accounts = (accountsRes.data ?? []) as Account[];
  const transactions = (txRes.data ?? []) as Transaction[];
  const projects = (projectsRes.data ?? []) as Project[];
  const categories = (categoriesRes.data ?? []) as Category[];

  const num = (n: number | string) => Number(n) || 0;

  // Earmarked accounts (e.g. project-specific loans) are excluded from general totals.
  const totalAvailable = accounts
    .filter((a) => !a.is_incoming && !a.project_id)
    .reduce((s, a) => s + num(a.balance), 0);
  const totalIncoming = accounts
    .filter((a) => a.is_incoming && !a.project_id)
    .reduce((s, a) => s + num(a.balance), 0);
  const earmarkedFunding = accounts
    .filter((a) => a.project_id)
    .reduce((s, a) => s + num(a.balance), 0);

  const expenses = transactions.filter((t) => t.type === "expense");
  const totalPaid = expenses
    .filter((t) => t.status === "paid")
    .reduce((s, t) => s + num(t.amount), 0);
  const totalCommitted = expenses
    .filter((t) => t.status === "paid" || t.status === "upcoming")
    .reduce((s, t) => s + num(t.amount), 0);
  const freeCash = totalAvailable - totalCommitted;

  // Per-project expenses (committed)
  const projectName = (id: string | null) =>
    projects.find((p) => p.id === id)?.name ?? "Χωρίς έργο";
  const byProjectMap = new Map<string, number>();
  for (const t of expenses) {
    if (t.status === "planned") continue;
    const key = projectName(t.project_id);
    byProjectMap.set(key, (byProjectMap.get(key) ?? 0) + num(t.amount));
  }
  const byProject = [...byProjectMap.entries()]
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value);

  // Per-category expenses
  const categoryName = (id: string | null) =>
    categories.find((c) => c.id === id)?.name ?? "Χωρίς κατηγορία";
  const byCatMap = new Map<string, number>();
  for (const t of expenses) {
    if (t.status === "planned") continue;
    const key = categoryName(t.category_id);
    byCatMap.set(key, (byCatMap.get(key) ?? 0) + num(t.amount));
  }
  const byCategory = [...byCatMap.entries()]
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-primary">Επισκόπηση</h1>
        <p className="text-sm text-muted">
          Συνολική εικόνα όλων των έργων και λογαριασμών
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard
          label="Διαθέσιμα κεφάλαια"
          value={totalAvailable}
          tone="primary"
          hint="Άθροισμα διαθέσιμων λογαριασμών"
          href="/accounts"
        />
        <StatCard
          label="Αναμενόμενα έσοδα"
          value={totalIncoming}
          hint="Γενικά αναμενόμενα κεφάλαια (χωρίς δεσμευμένα)"
          href="/income"
        />
        <StatCard
          label="Πληρωμένα έξοδα"
          value={totalPaid}
          hint="Κινήσεις σε κατάσταση «Πληρωμένο»"
          href="/transactions?type=expense&status=paid"
        />
        <StatCard
          label="Δεσμευμένα (πληρ. + επερχ.)"
          value={totalCommitted}
          hint="Πληρωμένα + Επερχόμενα έξοδα"
          href="/transactions?type=expense"
        />
        <StatCard
          label="Μετρητά"
          value={freeCash}
          tone={freeCash >= 0 ? "positive" : "negative"}
          hint="Διαθέσιμα κεφάλαια − Δεσμευμένα έξοδα"
        />
        <StatCard
          label="Σύνολο κεφαλαίων + έσοδα"
          value={totalAvailable + totalIncoming}
          hint="Διαθέσιμα + Αναμενόμενα (χωρίς δεσμευμένα έργων)"
          href="/accounts"
        />
        {earmarkedFunding > 0 && (
          <StatCard
            label="Χρηματοδότηση έργων (δεσμευμένη, εκτός συνόλου)"
            value={earmarkedFunding}
            hint="Δεσμευμένοι λογαριασμοί ανά έργο"
            href="/accounts"
          />
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Έξοδα ανά έργο</CardTitle>
          </CardHeader>
          <CardContent>
            <BarChartCard data={byProject} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Έξοδα ανά κατηγορία</CardTitle>
          </CardHeader>
          <CardContent>
            <PieChartCard data={byCategory} />
            <ChartLegend data={byCategory} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
