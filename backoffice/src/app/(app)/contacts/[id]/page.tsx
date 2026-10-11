import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { formatMoney, formatDate } from "@/lib/format";
import { el } from "@/lib/i18n/el";
import { PageHeader, Stat, StatRow } from "@/components/ui";

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
    <div className="flex flex-col gap-8">
      <PageHeader title={rollup.name} meta={rollup.afm ? <span className="num">ΑΦΜ: {rollup.afm}</span> : undefined} />

      <StatRow>
        <Stat label={el.contact.totalIncome} value={formatMoney(rollup.total_income)} />
        <Stat label={el.contact.totalExpense} value={formatMoney(rollup.total_expense)} />
        <Stat label={el.contact.outstanding} value={formatMoney(rollup.outstanding)} />
        <Stat label={el.contact.netBalance} value={formatMoney(rollup.net_balance)} />
      </StatRow>

      <section className="flex flex-col gap-3">
        <h2 className="eyebrow text-muted">{el.nav.transactions}</h2>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr>
                <th scope="col" className={TH}>{el.transaction.date}</th>
                <th scope="col" className={TH}>{el.transaction.project}</th>
                <th scope="col" className={TH}>{el.transaction.description}</th>
                <th scope="col" className={`${TH} text-right`}>{el.transaction.grossAmount}</th>
              </tr>
            </thead>
            <tbody className="text-text">
              {(transactions ?? []).map((tx) => {
                const project = Array.isArray(tx.projects) ? tx.projects[0] : tx.projects;
                return (
                  <tr key={tx.id} className="hover:bg-hover">
                    <td className={`${TD} num`}>{formatDate(tx.tx_date)}</td>
                    <td className={TD}>{project?.display_name ?? "—"}</td>
                    <td className={`${TD} min-w-40`}>{tx.description ?? "—"}</td>
                    <td className={`${TD} num text-right text-ink`}>
                      {tx.direction === "income" ? "+" : "−"}
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

// Spec-sheet table: uppercase 12px head over the navy rule, hairline rows.
const TH = "eyebrow border-b border-rule px-3 py-2.5 font-medium whitespace-nowrap text-muted";
const TD = "border-b border-hairline px-3 py-3 align-top";
