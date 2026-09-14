import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { formatMoney, formatDate } from "@/lib/format";
import { el } from "@/lib/i18n/el";
import { Badge, Card } from "@/components/ui";
import { BudgetFormModal } from "../BudgetFormModal";
import { saveProjectBudget } from "../budget-actions";

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const [{ data: rollup }, { data: transactions }, { data: budget }] = await Promise.all([
    supabase.from("v_project_rollup").select("*").eq("project_id", id).maybeSingle(),
    supabase
      .from("transactions")
      .select("id, tx_date, description, direction, status, gross_amount, contacts(name)")
      .eq("project_id", id)
      .order("tx_date", { ascending: false })
      .limit(100),
    supabase
      .from("project_budgets")
      .select("contingency_pct, budget_lines(line_code, amount)")
      .eq("project_id", id)
      .eq("is_current", true)
      .maybeSingle(),
  ]);

  if (!rollup) notFound();

  const budgetLines = Object.fromEntries(
    (budget?.budget_lines ?? []).map((l) => [l.line_code, l.amount]),
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">{rollup.display_name}</h1>
        <BudgetFormModal
          action={saveProjectBudget.bind(null, id)}
          initial={budget ? { contingency_pct: budget.contingency_pct ?? 0, lines: budgetLines } : undefined}
        />
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card>
          <div className="text-xs text-ink-muted">{el.project.budget}</div>
          <div className="font-mono text-lg">{formatMoney(rollup.total_budget)}</div>
        </Card>
        <Link href={`/transactions?project_id=${id}&direction=expense&status=paid`} className="block">
          <Card className="h-full transition-colors hover:border-line-strong hover:bg-bg">
            <div className="text-xs text-ink-muted">{el.project.spent}</div>
            <div className="font-mono text-lg">{formatMoney(rollup.spent)}</div>
          </Card>
        </Link>
        <Card>
          <div className="text-xs text-ink-muted">{el.project.remaining}</div>
          <div className="font-mono text-lg">{formatMoney(rollup.remaining_budget)}</div>
        </Card>
        <Link href={`/transactions?project_id=${id}&direction=income&status=paid`} className="block">
          <Card className="h-full transition-colors hover:border-line-strong hover:bg-bg">
            <div className="text-xs text-ink-muted">{el.project.income}</div>
            <div className="font-mono text-lg">{formatMoney(rollup.income_received)}</div>
          </Card>
        </Link>
      </div>

      <section>
        <h2 className="mb-2 text-sm font-medium text-ink-muted">{el.nav.transactions}</h2>
        <div className="overflow-x-auto rounded border border-line">
          <table className="w-full text-left text-sm">
            <thead className="bg-bg text-ink-muted">
              <tr>
                <th className="p-2">{el.transaction.date}</th>
                <th className="p-2">{el.transaction.contact}</th>
                <th className="p-2">{el.transaction.description}</th>
                <th className="p-2 text-right">{el.transaction.grossAmount}</th>
                <th className="p-2">{el.transaction.status}</th>
              </tr>
            </thead>
            <tbody>
              {(transactions ?? []).map((tx) => {
                const contact = Array.isArray(tx.contacts) ? tx.contacts[0] : tx.contacts;
                return (
                  <tr key={tx.id} className="border-t border-line">
                    <td className="p-2">{formatDate(tx.tx_date)}</td>
                    <td className="p-2">{contact?.name ?? "—"}</td>
                    <td className="p-2">{tx.description ?? "—"}</td>
                    <td
                      className={`p-2 text-right font-mono ${tx.direction === "income" ? "text-sage-ink" : ""}`}
                    >
                      {tx.direction === "income" ? "+" : "-"}
                      {formatMoney(tx.gross_amount)}
                    </td>
                    <td className="p-2">
                      <Badge>{el.transaction[tx.status as "paid" | "pending" | "scheduled" | "cancelled"]}</Badge>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
