import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle, Badge } from "@/components/ui";
import { PieChartCard, ChartLegend } from "@/components/Charts";
import { formatEuro, formatDate } from "@/lib/utils";
import {
  PROJECT_STATUS_LABEL,
  PROJECT_RISK_LABEL,
  TX_STATUS_LABEL,
  type Project,
  type Transaction,
  type Category,
  type Account,
  type Contact,
} from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const [projectRes, txRes, catRes, accRes, contactsRes] = await Promise.all([
    supabase.from("projects").select("*").eq("id", id).maybeSingle(),
    supabase.from("transactions").select("*").eq("project_id", id).order("tx_date", { ascending: false }),
    supabase.from("categories").select("*"),
    supabase.from("accounts").select("*").eq("project_id", id),
    supabase.from("contacts").select("*"),
  ]);

  const project = projectRes.data as Project | null;
  if (!project) notFound();

  const transactions = (txRes.data ?? []) as Transaction[];
  const categories = (catRes.data ?? []) as Category[];
  const earmarkedAccounts = (accRes.data ?? []) as Account[];
  const contacts = (contactsRes.data ?? []) as Contact[];
  const num = (n: number | string) => Number(n) || 0;
  const ownerName =
    contacts.find((c) => c.id === project.owner_contact_id)?.name ?? "—";

  const funding = earmarkedAccounts.reduce((s, a) => s + num(a.balance), 0);

  const expenses = transactions.filter((t) => t.type === "expense");
  const income = transactions.filter((t) => t.type === "income");
  const paid = expenses
    .filter((t) => t.status === "paid")
    .reduce((s, t) => s + num(t.amount), 0);
  const upcoming = expenses
    .filter((t) => t.status === "upcoming")
    .reduce((s, t) => s + num(t.amount), 0);
  const planned = expenses
    .filter((t) => t.status === "planned")
    .reduce((s, t) => s + num(t.amount), 0);
  const committed = expenses
    .filter((t) => t.status !== "planned")
    .reduce((s, t) => s + num(t.amount), 0);
  const incomeTotal = income.reduce((s, t) => s + num(t.amount), 0);
  const invoiced = expenses
    .filter((t) => t.has_invoice)
    .reduce((s, t) => s + num(t.amount), 0);
  const nonInvoiced = expenses
    .filter((t) => !t.has_invoice)
    .reduce((s, t) => s + num(t.amount), 0);
  const netPosition = funding + incomeTotal - committed;
  const executionPct = committed > 0 ? Math.min(100, (paid / committed) * 100) : 0;
  const budgetTarget = num(project.budget_target ?? 0);
  const budgetVariance = budgetTarget > 0 ? budgetTarget - committed : 0;

  const categoryName = (cid: string | null) =>
    categories.find((c) => c.id === cid)?.name ?? "Χωρίς κατηγορία";
  const byCatMap = new Map<string, number>();
  for (const t of expenses) {
    if (t.status === "planned") continue;
    const k = categoryName(t.category_id);
    byCatMap.set(k, (byCatMap.get(k) ?? 0) + num(t.amount));
  }
  const byCategory = [...byCatMap.entries()]
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value);

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/projects"
          className="mb-2 inline-flex items-center gap-1 text-sm text-muted hover:text-primary"
        >
          <ArrowLeft size={14} /> Πίσω στα έργα
        </Link>
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-primary">{project.name}</h1>
          <Badge tone={project.status}>
            {PROJECT_STATUS_LABEL[project.status]}
          </Badge>
        </div>
        {project.description && (
          <p className="mt-1 text-sm text-muted">{project.description}</p>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted">
          <span className="rounded-full bg-slate-100 px-2 py-1">
            Ρίσκο: {PROJECT_RISK_LABEL[project.risk_level] ?? PROJECT_RISK_LABEL.medium}
          </span>
          {project.owner_contact_id ? (
            <span className="rounded-full bg-slate-100 px-2 py-1">
              Υπεύθυνος: {ownerName}
            </span>
          ) : null}
          {(project.start_date || project.end_date) ? (
            <span className="rounded-full bg-slate-100 px-2 py-1">
              Διάστημα: {project.start_date ?? "—"} έως {project.end_date ?? "—"}
            </span>
          ) : null}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="pt-5">
            <p className="text-xs font-medium text-muted">Πληρωμένα</p>
            <p className="mt-1 text-2xl font-bold">{formatEuro(paid)}</p>
            <p className="mt-1 text-[11px] text-muted">
              Κινήσεις «Πληρωμένο» του έργου
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <p className="text-xs font-medium text-muted">Δεσμευμένα</p>
            <p className="mt-1 text-2xl font-bold text-primary">
              {formatEuro(committed)}
            </p>
            <p className="mt-1 text-[11px] text-muted">
              Πληρωμένα + Επερχόμενα
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <p className="text-xs font-medium text-muted">Έσοδα έργου</p>
            <p className="mt-1 text-2xl font-bold text-positive">
              {formatEuro(incomeTotal)}
            </p>
            <p className="mt-1 text-[11px] text-muted">
              Έσοδα καταχωρημένα στο έργο
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <p className="text-xs font-medium text-muted">Επερχόμενα έξοδα</p>
            <p className="mt-1 text-2xl font-bold text-warning">
              {formatEuro(upcoming)}
            </p>
            <p className="mt-1 text-[11px] text-muted">
              Κινήσεις «Επερχόμενο» του έργου
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <p className="text-xs font-medium text-muted">
              Χρηματοδότηση (δεσμευμένη)
            </p>
            <p className="mt-1 text-2xl font-bold text-accent">
              {formatEuro(funding)}
            </p>
            <p className="mt-1 text-[11px] text-muted">
              Δεσμευμένοι λογαριασμοί του έργου
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Πρόοδος εκτέλεσης εξόδων</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-primary">{Math.round(executionPct)}%</p>
            <p className="mt-1 text-xs text-muted">Πληρωμένα / Δεσμευμένα</p>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100">
              <div
                className="h-full rounded-full bg-primary"
                style={{ width: `${executionPct}%` }}
              />
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
              <div className="rounded-lg bg-slate-50 p-2">
                <p className="text-muted">Πληρωμένα</p>
                <p className="font-semibold">{formatEuro(paid)}</p>
              </div>
              <div className="rounded-lg bg-slate-50 p-2">
                <p className="text-muted">Planned</p>
                <p className="font-semibold">{formatEuro(planned)}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Ποιότητα καταγραφής εξόδων</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <div className="flex items-center justify-between rounded-lg bg-primary/10 px-3 py-2 text-sm">
                <span className="text-primary">Με παραστατικό</span>
                <span className="font-semibold text-primary">{formatEuro(invoiced)}</span>
              </div>
              <div className="flex items-center justify-between rounded-lg bg-slate-100 px-3 py-2 text-sm">
                <span className="text-slate-700">Χωρίς παραστατικό</span>
                <span className="font-semibold text-slate-700">{formatEuro(nonInvoiced)}</span>
              </div>
              <p className="text-xs text-muted">
                Βοηθά στον άμεσο έλεγχο της λογιστικής εικόνας του έργου.
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Καθαρή θέση έργου</CardTitle>
          </CardHeader>
          <CardContent>
            <p className={`text-2xl font-bold ${netPosition >= 0 ? "text-positive" : "text-negative"}`}>
              {formatEuro(netPosition)}
            </p>
            <p className="mt-1 text-xs text-muted">
              Χρηματοδότηση + Έσοδα έργου − Δεσμευμένα έξοδα
            </p>
            <div className="mt-3 space-y-1 text-xs text-muted">
              <p>Funding: {formatEuro(funding)}</p>
              <p>Έσοδα: {formatEuro(incomeTotal)}</p>
              <p>Δεσμευμένα: {formatEuro(committed)}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {budgetTarget > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Έλεγχος προϋπολογισμού</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div>
                <p className="text-xs text-muted">Budget στόχος</p>
                <p className="text-lg font-semibold">{formatEuro(budgetTarget)}</p>
              </div>
              <div>
                <p className="text-xs text-muted">Δεσμευμένα</p>
                <p className="text-lg font-semibold text-primary">{formatEuro(committed)}</p>
              </div>
              <div>
                <p className="text-xs text-muted">Απόκλιση</p>
                <p className={`text-lg font-semibold ${budgetVariance >= 0 ? "text-positive" : "text-negative"}`}>
                  {formatEuro(budgetVariance)}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Έξοδα ανά κατηγορία</CardTitle>
          </CardHeader>
          <CardContent>
            <PieChartCard data={byCategory} />
            <ChartLegend data={byCategory} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Κινήσεις έργου</CardTitle>
          </CardHeader>
          <CardContent>
            {transactions.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted">
                Δεν υπάρχουν κινήσεις για αυτό το έργο.
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {transactions.map((t) => (
                  <li
                    key={t.id}
                    className="flex items-center justify-between py-2 text-sm"
                  >
                    <div>
                      <p className="font-medium">
                        {categoryName(t.category_id)}
                      </p>
                      <p className="text-xs text-muted">
                        {formatDate(t.tx_date)} · {TX_STATUS_LABEL[t.status]}
                      </p>
                    </div>
                    <span
                      className={
                        t.type === "income"
                          ? "font-semibold text-positive"
                          : "font-semibold"
                      }
                    >
                      {t.type === "income" ? "+" : "−"}
                      {formatEuro(num(t.amount))}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
