import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { formatMoney, formatDate } from "@/lib/format";
import { el } from "@/lib/i18n/el";
import { Card } from "@/components/ui";

export default async function ContactDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const [{ data: rollup }, { data: transactions }] = await Promise.all([
    supabase.from("v_contact_rollup").select("*").eq("contact_id", id).maybeSingle(),
    supabase
      .from("transactions")
      .select("id, tx_date, description, direction, status, gross_amount, projects(display_name)")
      .eq("contact_id", id)
      .order("tx_date", { ascending: false })
      .limit(100),
  ]);

  if (!rollup) notFound();

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">{rollup.name}</h1>
      {rollup.afm && <p className="text-sm text-ink-muted">ΑΦΜ: {rollup.afm}</p>}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card>
          <div className="text-xs text-ink-muted">{el.contact.totalIncome}</div>
          <div className="font-mono text-lg">{formatMoney(rollup.total_income)}</div>
        </Card>
        <Card>
          <div className="text-xs text-ink-muted">{el.contact.totalExpense}</div>
          <div className="font-mono text-lg">{formatMoney(rollup.total_expense)}</div>
        </Card>
        <Card>
          <div className="text-xs text-ink-muted">{el.contact.outstanding}</div>
          <div className="font-mono text-lg">{formatMoney(rollup.outstanding)}</div>
        </Card>
        <Card>
          <div className="text-xs text-ink-muted">{el.contact.netBalance}</div>
          <div className="font-mono text-lg">{formatMoney(rollup.net_balance)}</div>
        </Card>
      </div>

      <section>
        <h2 className="mb-2 text-sm font-medium text-ink-muted">{el.nav.transactions}</h2>
        <div className="overflow-x-auto rounded-lg border border-line">
          <table className="w-full text-left text-sm">
            <thead className="bg-bg text-ink-muted">
              <tr>
                <th className="p-2">{el.transaction.date}</th>
                <th className="p-2">{el.transaction.project}</th>
                <th className="p-2">{el.transaction.description}</th>
                <th className="p-2 text-right">{el.transaction.grossAmount}</th>
              </tr>
            </thead>
            <tbody>
              {(transactions ?? []).map((tx) => {
                const project = Array.isArray(tx.projects) ? tx.projects[0] : tx.projects;
                return (
                  <tr key={tx.id} className="border-t border-line">
                    <td className="p-2">{formatDate(tx.tx_date)}</td>
                    <td className="p-2">{project?.display_name ?? "—"}</td>
                    <td className="p-2">{tx.description ?? "—"}</td>
                    <td
                      className={`p-2 text-right font-mono ${tx.direction === "income" ? "text-sage-ink" : ""}`}
                    >
                      {tx.direction === "income" ? "+" : "-"}
                      {formatMoney(tx.gross_amount)}
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
