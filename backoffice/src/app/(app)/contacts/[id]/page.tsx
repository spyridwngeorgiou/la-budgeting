import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { formatMoney, formatDate } from "@/lib/format";
import { el } from "@/lib/i18n/el";
import { PageHeader, SpecTable, Stat, StatRow, Td, Th, Tr } from "@/components/ui";

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
    <div className="flex flex-col gap-6">
      <PageHeader title={rollup.name} meta={rollup.afm ? <span className="num">ΑΦΜ: {rollup.afm}</span> : undefined} />

      <StatRow>
        <Stat label={el.contact.totalIncome} value={formatMoney(rollup.total_income)} />
        <Stat label={el.contact.totalExpense} value={formatMoney(rollup.total_expense)} />
        <Stat label={el.contact.outstanding} value={formatMoney(rollup.outstanding)} />
        <Stat label={el.contact.netBalance} value={formatMoney(rollup.net_balance)} />
      </StatRow>

      <section className="flex flex-col gap-4">
        <h2 className="eyebrow text-muted">{el.nav.transactions}</h2>
        <SpecTable label={el.nav.transactions}>
          <thead>
            <tr>
              <Th>{el.transaction.date}</Th>
              <Th>{el.transaction.project}</Th>
              <Th>{el.transaction.description}</Th>
              <Th numeric>{el.transaction.grossAmount}</Th>
            </tr>
          </thead>
          <tbody>
            {(transactions ?? []).map((tx) => {
              const project = Array.isArray(tx.projects) ? tx.projects[0] : tx.projects;
              return (
                <Tr key={tx.id}>
                  <Td className="num">{formatDate(tx.tx_date)}</Td>
                  <Td>{project?.display_name ?? "—"}</Td>
                  <Td className="min-w-40">{tx.description ?? "—"}</Td>
                  <Td numeric strong>
                    {tx.direction === "income" ? "+" : "−"}
                    {formatMoney(tx.gross_amount)}
                  </Td>
                </Tr>
              );
            })}
          </tbody>
        </SpecTable>
      </section>
    </div>
  );
}
