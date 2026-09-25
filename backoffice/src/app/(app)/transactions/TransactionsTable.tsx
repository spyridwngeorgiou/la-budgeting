"use client";

import { useMemo, useState } from "react";
import { formatMoney, formatDate } from "@/lib/format";
import { el } from "@/lib/i18n/el";
import { AiSpark, Badge, Button, Input, Card } from "@/components/ui";
import { TransactionFormModal, type TransactionInitial } from "./TransactionFormModal";
import { PartialPaymentModal } from "./PartialPaymentModal";
import { createTransaction, updateTransaction, markPaid, deleteTransaction, getSourceDocumentUrl } from "./actions";

const AI_ORIGINS = new Set(["ai_document", "ai_nl"]);

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
  due_date: string | null;
  paid_on: string | null;
  plan_id: string | null;
  property_project_id: string | null;
  description: string | null;
  direction: string;
  status: string;
  scope: string | null;
  gross_amount: number | null;
  net_amount: number | null;
  vat_rate: number | null;
  withholding_amount: number | null;
  has_invoice: boolean | null;
  invoice_number: string | null;
  contact_id: string | null;
  project_id: string | null;
  category_id: string | null;
  account_id: string | null;
  contact_name: string | null;
  project_name: string | null;
  category_name: string | null;
  origin: string | null;
  has_source_document: boolean;
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
  exportHref,
}: {
  transactions: TxRow[];
  contacts: Option[];
  projects: Option[];
  categories: Option[];
  accounts: Option[];
  filters?: React.ReactNode;
  exportHref?: string;
}) {
  // Exactly one modal instance for the whole table, whichever row (or
  // "create") is active -- not one per row. `key` forces a clean remount
  // when switching targets, so stale form state never leaks between rows.
  const [target, setTarget] = useState<"create" | TxRow | null>(null);
  const [paying, setPaying] = useState<TxRow | null>(null);
  const [search, setSearch] = useState("");
  const [deleting, setDeleting] = useState<string | null>(null);
  const [loadingSource, setLoadingSource] = useState<string | null>(null);

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

  // The total is a claim about exactly the rows on screen -- recomputed from
  // visibleTransactions (post-search), same "number IS the rows behind it"
  // principle the rest of the app already follows (analysis, cashflow).
  const summary = useMemo(() => {
    let income = 0;
    let expense = 0;
    for (const tx of visibleTransactions) {
      const amount = Number(tx.gross_amount ?? 0);
      if (tx.direction === "income") income += amount;
      else expense += amount;
    }
    return { income, expense, net: income - expense, count: visibleTransactions.length };
  }, [visibleTransactions]);

  const todayIso = new Date().toISOString().slice(0, 10);
  const isOverdue = (tx: TxRow) => tx.status !== "paid" && !!tx.due_date && tx.due_date < todayIso;

  const initialFor = (tx: TxRow): TransactionInitial => ({
    tx_date: tx.tx_date,
    due_date: tx.due_date,
    paid_on: tx.paid_on,
    property_project_id: tx.property_project_id,
    direction: tx.direction,
    status: tx.status,
    scope: tx.scope ?? undefined,
    net_amount: tx.net_amount ?? 0,
    vat_rate: tx.vat_rate,
    withholding_amount: tx.withholding_amount ?? 0,
    has_invoice: tx.has_invoice ?? false,
    description: tx.description,
    invoice_number: tx.invoice_number,
    contact_id: tx.contact_id,
    project_id: tx.project_id,
    category_id: tx.category_id,
    account_id: tx.account_id,
  });

  async function handleViewSource(tx: TxRow) {
    setLoadingSource(tx.id);
    try {
      const url = await getSourceDocumentUrl(tx.id);
      if (url) window.open(url, "_blank", "noopener,noreferrer");
      else window.alert("Το πρωτότυπο αρχείο δεν είναι πλέον διαθέσιμο.");
    } finally {
      setLoadingSource(null);
    }
  }

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
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold">{el.nav.transactions}</h1>
          <p className="mt-1 text-sm text-ink-muted">Το πλήρες βιβλίο εσόδων-εξόδων. Φιλτράρετε, αναζητήστε, επεξεργαστείτε.</p>
        </div>
        <div className="flex items-center gap-2">
          {exportHref && (
            <a href={exportHref}>
              <Button variant="secondary">Εξαγωγή CSV</Button>
            </a>
          )}
          <Button onClick={() => setTarget("create")}>+ Νέα Κίνηση</Button>
        </div>
      </div>

      {filters}

      <div className="flex flex-wrap items-center gap-3">
        <Input
          type="search"
          placeholder="Αναζήτηση σε επαφή, έργο, κατηγορία, περιγραφή, αρ. παραστατικού…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-md flex-1"
        />
        <Card className="flex items-center gap-4 !p-2.5 text-xs">
          <span className="text-ink-muted">
            {summary.count} κίνησ{summary.count === 1 ? "η" : "εις"}
          </span>
          <span className="text-sage-ink">Έσοδα {formatMoney(summary.income)}</span>
          <span className="text-red-ink">Έξοδα {formatMoney(summary.expense)}</span>
          <span className={`font-medium ${summary.net < 0 ? "text-red-ink" : "text-ink"}`}>
            Καθαρό {formatMoney(summary.net)}
          </span>
        </Card>
      </div>

      <div className="max-h-[70vh] overflow-auto rounded border border-line">
        <table className="w-full text-left text-sm">
          <thead className="sticky top-0 z-10 border-b border-line-strong bg-bg text-ink-muted">
            <tr>
              <th className="p-2">{el.transaction.date}</th>
              <th className="p-2">{el.transaction.contact}</th>
              <th className="hidden p-2 sm:table-cell">{el.transaction.project}</th>
              <th className="hidden p-2 md:table-cell">{el.transaction.category}</th>
              <th className="p-2 text-right">{el.transaction.grossAmount}</th>
              <th className="p-2">{el.transaction.status}</th>
              <th className="p-2"></th>
            </tr>
          </thead>
          <tbody>
            {visibleTransactions.map((tx, i) => (
              <tr
                key={tx.id}
                className={`border-t border-line hover:bg-sage/20 ${i % 2 === 1 ? "bg-bg/60" : ""}`}
              >
                <td className="p-2 whitespace-nowrap">{formatDate(tx.tx_date)}</td>
                <td className="p-2 whitespace-nowrap">
                  <span className="inline-flex items-center gap-1.5">
                    {tx.contact_name ?? "—"}
                    {AI_ORIGINS.has(tx.origin ?? "") && (
                      <span title="Καταχωρήθηκε μέσω AI, επιβεβαιωμένη από άνθρωπο πριν καταγραφεί">
                        <AiSpark className="text-ai-ink" />
                      </span>
                    )}
                  </span>
                </td>
                <td className="hidden p-2 whitespace-nowrap sm:table-cell">{tx.project_name ?? "—"}</td>
                <td className="hidden p-2 whitespace-nowrap md:table-cell">{tx.category_name ?? "—"}</td>
                <td
                  className={`p-2 text-right font-mono whitespace-nowrap ${
                    tx.direction === "income" ? "text-sage-ink" : "text-red-ink"
                  }`}
                >
                  {tx.direction === "income" ? "+" : "-"}
                  {formatMoney(tx.gross_amount)}
                </td>
                <td className="p-2">
                  <div className="flex items-center gap-1.5">
                    <Badge tone={STATUS_TONE[tx.status as keyof typeof STATUS_TONE]}>
                      {STATUS_LABEL[tx.status as keyof typeof STATUS_LABEL]}
                    </Badge>
                    {isOverdue(tx) && <Badge tone="red">εκπρόθεσμη</Badge>}
                  </div>
                </td>
                <td className="p-2">
                  <div className="flex items-center justify-end gap-2">
                    {tx.has_source_document && (
                      <Button
                        variant="secondary"
                        className="!px-2 !py-1 text-xs"
                        disabled={loadingSource === tx.id}
                        onClick={() => handleViewSource(tx)}
                      >
                        {loadingSource === tx.id ? "…" : "Πρωτότυπο"}
                      </Button>
                    )}
                    {(tx.status === "pending" || tx.status === "scheduled") && !tx.plan_id && (
                      <Button
                        variant="secondary"
                        className="!px-2 !py-1 text-xs"
                        onClick={() => setPaying(tx)}
                      >
                        Μερική πληρωμή
                      </Button>
                    )}
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

      {paying && (
        <PartialPaymentModal
          key={paying.id}
          transactionId={paying.id}
          label={paying.description ?? paying.contact_name ?? formatDate(paying.tx_date)}
          remaining={Number(paying.gross_amount ?? 0)}
          accountId={paying.account_id}
          accounts={accounts}
          onClose={() => setPaying(null)}
        />
      )}
    </div>
  );
}
