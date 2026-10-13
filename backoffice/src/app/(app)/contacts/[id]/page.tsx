import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { formatMoney, formatDate } from "@/lib/format";
import { el } from "@/lib/i18n/el";
import { Amount, EmptyState, MetaList, PageHeader, SectionHeader, ShownCount, SpecTable, Stat, StatRow, StatusDot, Td, Th, Tr } from "@/components/ui";
import { ContactFormButton } from "../ContactForm";

// The latest movements with the contact; the full list is /transactions
// filtered by it («όλες στις Κινήσεις →»).
const LIMIT = 100;

const STATUS_TONE = { paid: "neutral", pending: "warning", scheduled: "neutral", cancelled: "neutral" } as const;

export default async function ContactDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const [{ data: rollup }, { data: contact }, { data: transactions, count }] = await Promise.all([
    supabase.from("v_contact_rollup").select("*").eq("contact_id", id).maybeSingle(),
    supabase.from("contacts").select("id, name, afm, phone, email").eq("id", id).maybeSingle(),
    supabase
      .from("transactions")
      .select("id, tx_date, description, direction, status, gross_amount, projects(display_name)", { count: "exact" })
      .eq("contact_id", id)
      .order("tx_date", { ascending: false })
      .limit(LIMIT),
  ]);

  if (!rollup || !contact) notFound();
  const rows = transactions ?? [];
  const total = count ?? rows.length;
  const c = el.contact;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow={
          <Link href="/contacts" className="inline-flex min-h-8 items-center hover:text-ink">
            {c.back}
          </Link>
        }
        title={contact.name}
        meta={
          <MetaList
            items={[
              contact.afm && <span className="num">ΑΦΜ: {contact.afm}</span>,
              contact.phone,
              contact.email,
            ]}
          />
        }
        actions={<ContactFormButton contact={contact} label={el.common.edit} variant="secondary" />}
      />

      <StatRow>
        <Stat label={c.totalIncome} value={formatMoney(rollup.total_income)} />
        <Stat label={c.totalExpense} value={formatMoney(rollup.total_expense)} />
        <Stat label={c.outstanding} value={formatMoney(rollup.outstanding)} />
        <Stat label={c.netBalance} value={formatMoney(rollup.net_balance)} />
      </StatRow>

      <section aria-labelledby="contact-transactions" className="flex flex-col gap-3">
        <SectionHeader
          title={
            <>
              <span id="contact-transactions">{el.nav.transactions}</span> <span className="num text-body text-muted">{total}</span>
            </>
          }
        />
        {rows.length === 0 ? (
          <EmptyState title={c.noTransactions} body={c.noTransactionsHint} />
        ) : (
          <>
            <SpecTable label={el.nav.transactions}>
              <thead>
                <tr>
                  <Th>{el.transaction.date}</Th>
                  <Th className="hidden sm:table-cell">{el.transaction.project}</Th>
                  <Th>{el.transaction.description}</Th>
                  <Th numeric>{el.transaction.grossAmount}</Th>
                  <Th>{el.transaction.status}</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((tx) => {
                  const project = Array.isArray(tx.projects) ? tx.projects[0] : tx.projects;
                  const status = tx.status as keyof typeof STATUS_TONE;
                  return (
                    <Tr key={tx.id}>
                      <Td className="num">{formatDate(tx.tx_date)}</Td>
                      <Td className="hidden sm:table-cell">{project?.display_name ?? "—"}</Td>
                      <Td className="min-w-40">{tx.description ?? "—"}</Td>
                      <Td numeric strong>
                        <Amount value={tx.direction === "income" ? Number(tx.gross_amount) : -Number(tx.gross_amount)} />
                      </Td>
                      <Td>
                        <StatusDot tone={STATUS_TONE[status] ?? "neutral"} label={el.transaction[status] ?? tx.status} />
                      </Td>
                    </Tr>
                  );
                })}
              </tbody>
            </SpecTable>
            <ShownCount
              shown={rows.length}
              total={total}
              href={`/transactions?contact_id=${id}`}
              linkLabel={c.allTransactions}
            />
          </>
        )}
      </section>
    </div>
  );
}
