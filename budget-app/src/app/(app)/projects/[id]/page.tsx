import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle, Badge } from "@/components/ui";
import { PieChartCard, ChartLegend } from "@/components/Charts";
import { formatEuro, formatDate } from "@/lib/utils";
import {
  PROJECT_STATUS_LABEL,
  TX_STATUS_LABEL,
  type Project,
  type Transaction,
  type Category,
} from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const [projectRes, txRes, catRes] = await Promise.all([
    supabase.from("projects").select("*").eq("id", id).maybeSingle(),
    supabase.from("transactions").select("*").eq("project_id", id).order("tx_date", { ascending: false }),
    supabase.from("categories").select("*"),
  ]);

  const project = projectRes.data as Project | null;
  if (!project) notFound();

  const transactions = (txRes.data ?? []) as Transaction[];
  const categories = (catRes.data ?? []) as Category[];
  const num = (n: number | string) => Number(n) || 0;

  const expenses = transactions.filter((t) => t.type === "expense");
  const income = transactions.filter((t) => t.type === "income");
  const paid = expenses
    .filter((t) => t.status === "paid")
    .reduce((s, t) => s + num(t.amount), 0);
  const committed = expenses
    .filter((t) => t.status !== "planned")
    .reduce((s, t) => s + num(t.amount), 0);
  const incomeTotal = income.reduce((s, t) => s + num(t.amount), 0);

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
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="pt-5">
            <p className="text-xs font-medium text-muted">Πληρωμένα</p>
            <p className="mt-1 text-2xl font-bold">{formatEuro(paid)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <p className="text-xs font-medium text-muted">Δεσμευμένα</p>
            <p className="mt-1 text-2xl font-bold text-primary">
              {formatEuro(committed)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <p className="text-xs font-medium text-muted">Έσοδα έργου</p>
            <p className="mt-1 text-2xl font-bold text-positive">
              {formatEuro(incomeTotal)}
            </p>
          </CardContent>
        </Card>
      </div>

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
