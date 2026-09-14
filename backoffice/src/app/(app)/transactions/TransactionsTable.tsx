"use client";

import { useMemo, useState } from "react";
import { formatMoney, formatDate } from "@/lib/format";
import { el } from "@/lib/i18n/el";
import { Badge, Button, Input } from "@/components/ui";
import { TransactionFormModal, type TransactionInitial } from "./TransactionFormModal";
import { createTransaction, updateTransaction, markPaid, deleteTransaction } from "./actions";

const STATUS_TONE = { paid: "green", pending: "amber", scheduled: "neutral", cancelled: "red" } as const;
const STATUS_LABEL = {
  paid: el.transaction.paid,
  pending: el.transaction.pending,
  scheduled: el.transaction.scheduled,
  cancelled: el.transaction.cancelled,
} as const;

interface Option {
  id: string;
  label: string;
}

interface TxRow {
  id: string;
  tx_date: string;
  description: string | null;
  direction: string;
  status: string;
  gross_amount: number | null;
  net_amount: number | null;
  vat_rate: number | null;
  withholding_amount: number | null;
  has_invoice: boolean | null;
  invoice_number: string | null;
  contact_name: string | null;
  project_name: string | null;
  category_name: string | null;
}

function normalize(s: string) {
  return s.toLocaleLowerCase("el");
}

export function TransactionsTable({
  transactions,
  contacts,
  projects,
  categories,
  accounts,
  filters,
}: {
  transactions: TxRow[];
  contacts: Option[];
  projects: Option[];
  categories: Option[];
  accounts: Option[];
  filters?: React.ReactNode;
}) {
  // Exactly one modal instance for the whole table, whichever row (or
  // "create") is active -- not one per row. `key` forces a clean remount
  // when switching targets, so stale form state never leaks between rows.
  const [target, setTarget] = useState<"create" | TxRow | null>(null);
  const [search, setSearch] = useState("");
  const [deleting, setDeleting] = useState<string | null>(null);

  // Filtered client-side over the page's already-loaded rows -- instant as
  // you type, no round trip, since this is at most a few hundred rows.
  const visibleTransactions = useMemo(() => {
    const q = normalize(search.trim());
    if (!q) return transactions;
    return transactions.filter((tx) =>
      [tx.description, tx.contact_name, tx.project_name, tx.category_name, tx.invoice_number]
        .filter(Boolean)
        .some((field) => normalize(field as string).includes(q)),
    );
  }, [transactions, search]);

  const initialFor = (tx: TxRow): TransactionInitial => ({
    tx_date: tx.tx_date,
    direction: tx.direction,
    status: tx.status,
    net_amount: tx.net_amount ?? 0,
    vat_rate: tx.vat_rate,
    withholding_amount: tx.withholding_amount ?? 0,
    has_invoice: tx.has_invoice ?? false,
    description: tx.description,
    invoice_number: tx.invoice_number,
  });

  async function handleDelete(tx: TxRow) {
    const label = tx.description || tx.contact_name || formatDate(tx.tx_date);
    if (!window.confirm(`Διαγραφή της κίνησης «${label}»; Η ενέργεια δεν αναιρείται.`)) return;
    setDeleting(tx.id);
    try {
      await deleteTransaction(tx.id);
    } finally {
      setDeleting(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">{el.nav.transactions}</h1>
        <Button onClick={() => setTarget("create")}>+ Νέα Κίνηση</Button>
      </div>

      {filters}

      <Input
        type="search"
        placeholder="Αναζήτηση σε επαφή, έργο, κατηγορία, περιγραφή, αρ. παραστατικού…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="max-w-md"
      />

      <div className="overflow-x-auto rounded border border-line">
        <table className="w-full text-left text-sm">
          <thead className="bg-bg text-ink-muted">
            <tr>
              <th className="p-2">{el.transaction.date}</th>
              <th className="p-2">{el.transaction.contact}</th>
              <th className="p-2">{el.transaction.project}</th>
              <th className="p-2">{el.transaction.category}</th>
              <th className="p-2 text-right">{el.transaction.grossAmount}</th>
              <th className="p-2">{el.transaction.status}</th>
              <th className="p-2"></th>
            </tr>
          </thead>
          <tbody>
            {visibleTransactions.map((tx) => (
              <tr key={tx.id} className="border-t border-line">
                <td className="p-2">{formatDate(tx.tx_date)}</td>
                <td className="p-2">{tx.contact_name ?? "—"}</td>
                <td className="p-2">{tx.project_name ?? "—"}</td>
                <td className="p-2">{tx.category_name ?? "—"}</td>
                <td className={`p-2 text-right font-mono ${tx.direction === "income" ? "text-sage-ink" : ""}`}>
                  {tx.direction === "income" ? "+" : "-"}
                  {formatMoney(tx.gross_amount)}
                </td>
                <td className="p-2">
                  <Badge tone={STATUS_TONE[tx.status as keyof typeof STATUS_TONE]}>
                    {STATUS_LABEL[tx.status as keyof typeof STATUS_LABEL]}
                  </Badge>
                </td>
                <td className="p-2">
                  <div className="flex items-center justify-end gap-2">
                    {tx.status !== "paid" && (
                      <form action={markPaid.bind(null, tx.id)}>
                        <Button type="submit" variant="secondary" className="!px-2 !py-1 text-xs">
                          {el.common.markPaid}
                        </Button>
                      </form>
                    )}
                    <Button
                      variant="secondary"
                      className="!px-2 !py-1 text-xs"
                      onClick={() => setTarget(tx)}
                    >
                      {el.common.edit}
                    </Button>
                    <Button
                      variant="danger"
                      className="!px-2 !py-1 text-xs"
                      disabled={deleting === tx.id}
                      onClick={() => handleDelete(tx)}
                    >
                      {deleting === tx.id ? "…" : el.common.delete}
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
            {visibleTransactions.length === 0 && (
              <tr>
                <td colSpan={7} className="p-6 text-center text-ink-muted">
                  {transactions.length === 0
                    ? "Δεν υπάρχουν ακόμα κινήσεις. Πατήστε «+ Νέα Κίνηση» για να ξεκινήσετε."
                    : "Καμία κίνηση δεν ταιριάζει με την αναζήτηση."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {target && (
        <TransactionFormModal
          key={target === "create" ? "create" : target.id}
          action={target === "create" ? createTransaction : updateTransaction.bind(null, target.id)}
          contacts={contacts}
          projects={projects}
          categories={categories}
          accounts={accounts}
          initial={target === "create" ? undefined : initialFor(target)}
          onClose={() => setTarget(null)}
        />
      )}
    </div>
  );
}
