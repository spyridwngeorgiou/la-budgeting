"use client";

import { useMemo, useState } from "react";
import { formatMoney, formatDate } from "@/lib/format";
import { el } from "@/lib/i18n/el";
import { AiSpark, Badge, Button, Input, PageHeader, buttonClass } from "@/components/ui";
import { TransactionFormModal, type TransactionInitial } from "./TransactionFormModal";
import { PartialPaymentModal } from "./PartialPaymentModal";
import { createTransaction, updateTransaction, markPaid, deleteTransaction, getSourceDocumentUrl } from "./actions";
import { todayAthens } from "@/lib/dates";
import { errorOf } from "@/lib/actions";

const AI_ORIGINS = new Set(["ai_document", "ai_nl"]);

// P15: colour only for exceptions. Paid, scheduled and cancelled rows are
// read from the label (neutral); pending is the one to watch; overdue is
// the exception (red, plus a 2px bar on the row).
const STATUS_TONE = { paid: "neutral", pending: "warning", scheduled: "neutral", cancelled: "neutral" } as const;
const STATUS_LABEL = {
  paid: el.transaction.paid,
  pending: el.transaction.pending,
  scheduled: el.transaction.scheduled,
  cancelled: el.transaction.cancelled,
} as const;

// Spec-sheet cells. Below md each row is a CSS grid (a card) and the cells
// are blocks placed in it; from md up they are ordinary table cells.
const TH =
  "eyebrow sticky top-0 z-10 border-b border-rule bg-canvas px-3 py-2.5 text-left font-medium whitespace-nowrap text-muted";
const TD = "block md:table-cell md:border-b md:border-hairline md:px-3 md:py-3 md:align-top";
// Row actions: 32px on desktop, 44px on a phone.
const ROW_ACTION = "max-md:min-h-11";

// An amount with its sign instead of a colour: −3.200,00 € / +12.400,00 €.
function signed(n: number) {
  return `${n > 0 ? "+" : n < 0 ? "−" : ""}${formatMoney(Math.abs(n))}`;
}

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
  startCreating = false,
}: {
  transactions: TxRow[];
  contacts: Option[];
  projects: Option[];
  categories: Option[];
  accounts: Option[];
  filters?: React.ReactNode;
  exportHref?: string;
  startCreating?: boolean;
}) {
  // Exactly one modal instance for the whole table, whichever row (or
  // "create") is active -- not one per row. `key` forces a clean remount
  // when switching targets, so stale form state never leaks between rows.
  const [target, setTarget] = useState<"create" | TxRow | null>(startCreating ? "create" : null);
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

  const todayIso = todayAthens();
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
      const message = errorOf(await deleteTransaction(tx.id));
      if (message) window.alert(message);
    } finally {
      setDeleting(null);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={el.nav.transactions}
        meta="Το πλήρες βιβλίο εσόδων-εξόδων. Φιλτράρετε, αναζητήστε, επεξεργαστείτε."
        actions={
          <>
            {exportHref && (
              <a href={exportHref} className={buttonClass("secondary", "md", "max-md:min-h-11")}>
                Εξαγωγή CSV
              </a>
            )}
            <Button onClick={() => setTarget("create")} className="max-md:min-h-11">
              + Νέα Κίνηση
            </Button>
          </>
        }
      />

      {filters}

      <div className="flex flex-col gap-3 md:flex-row md:flex-wrap md:items-center md:justify-between md:gap-6">
        <Input
          type="search"
          placeholder="Αναζήτηση σε επαφή, έργο, κατηγορία, περιγραφή, αρ. παραστατικού…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full max-md:min-h-11 md:max-w-md md:flex-1"
        />
        <p className="flex flex-wrap items-baseline gap-x-6 gap-y-1 text-small text-muted">
          <span>
            <span className="num">{summary.count}</span> κίνησ{summary.count === 1 ? "η" : "εις"}
          </span>
          <span>
            Έσοδα <span className="num text-text">{signed(summary.income)}</span>
          </span>
          <span>
            Έξοδα <span className="num text-text">{signed(-summary.expense)}</span>
          </span>
          <span>
            Καθαρό <span className="num font-medium text-ink">{signed(summary.net)}</span>
          </span>
        </p>
      </div>

      {/* One list, laid out by CSS: a spec-sheet table from md up (scrolling
          inside its own frame under a sticky head), a stack of hairline
          cards on a phone. Never rendered twice -- this can be 500 rows. */}
      <div className="md:max-h-[70vh] md:overflow-auto">
        <table className="block w-full border-collapse text-left text-sm md:table">
          <thead className="hidden md:table-header-group">
            <tr>
              <th scope="col" className={TH}>
                {el.transaction.date}
              </th>
              <th scope="col" className={TH}>
                {el.transaction.contact}
              </th>
              <th scope="col" className={TH}>
                {el.transaction.project}
              </th>
              <th scope="col" className={TH}>
                {el.transaction.category}
              </th>
              <th scope="col" className={`${TH} text-right`}>
                {el.transaction.grossAmount}
              </th>
              <th scope="col" className={TH}>
                {el.transaction.status}
              </th>
              <th scope="col" className={TH}></th>
            </tr>
          </thead>
          <tbody className="block border-t border-rule md:table-row-group md:border-t-0">
            {visibleTransactions.map((tx) => {
              const overdue = isOverdue(tx);
              return (
                <tr
                  key={tx.id}
                  className={`grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1 border-b border-hairline py-3 md:table-row md:border-b-0 md:py-0 md:hover:bg-hover ${
                    overdue ? "border-l-2 border-l-negative pl-3 md:border-l-0 md:pl-0" : ""
                  }`}
                >
                  <td
                    className={`${TD} col-start-1 row-start-1 text-small text-muted md:text-sm md:text-text ${
                      overdue ? "md:border-l-2 md:border-l-negative" : ""
                    }`}
                  >
                    <span className="num">{formatDate(tx.tx_date)}</span>
                  </td>
                  <td className={`${TD} col-start-1 row-start-2 min-w-0 text-body text-ink md:text-sm`}>
                    <span className="inline-flex items-center gap-1.5 md:whitespace-nowrap">
                      {tx.contact_name ?? "—"}
                      {AI_ORIGINS.has(tx.origin ?? "") && (
                        <span title="Καταχωρήθηκε μέσω AI, επιβεβαιωμένη από άνθρωπο πριν καταγραφεί">
                          <AiSpark className="text-ai" />
                        </span>
                      )}
                    </span>
                  </td>
                  <td
                    className={`${TD} col-span-2 col-start-1 row-start-3 text-small text-muted md:text-sm md:whitespace-nowrap md:text-text`}
                  >
                    <span className="md:hidden">{el.transaction.project} · </span>
                    {tx.project_name ?? "—"}
                  </td>
                  <td
                    className={`${TD} col-span-2 col-start-1 row-start-4 text-small text-muted md:text-sm md:whitespace-nowrap md:text-text`}
                  >
                    <span className="md:hidden">{el.transaction.category} · </span>
                    {tx.category_name ?? "—"}
                  </td>
                  <td className={`${TD} num col-start-2 row-start-1 text-right text-body text-ink md:text-sm`}>
                    {tx.direction === "income" ? "+" : "−"}
                    {formatMoney(tx.gross_amount)}
                  </td>
                  <td className={`${TD} col-start-2 row-start-2 justify-self-end md:justify-self-auto`}>
                    <div className="flex flex-wrap items-center justify-end gap-1.5 md:justify-start">
                      <Badge tone={STATUS_TONE[tx.status as keyof typeof STATUS_TONE]}>
                        {STATUS_LABEL[tx.status as keyof typeof STATUS_LABEL]}
                      </Badge>
                      {overdue && <Badge tone="negative">εκπρόθεσμη</Badge>}
                    </div>
                  </td>
                  <td className={`${TD} col-span-2 col-start-1 row-start-5 pt-2 md:py-1.5`}>
                    <div className="flex flex-wrap items-center gap-2 md:flex-nowrap md:justify-end">
                      {tx.has_source_document && (
                        <Button
                          variant="secondary"
                          size="sm"
                          className={ROW_ACTION}
                          disabled={loadingSource === tx.id}
                          onClick={() => handleViewSource(tx)}
                        >
                          {loadingSource === tx.id ? "…" : "Πρωτότυπο"}
                        </Button>
                      )}
                      {(tx.status === "pending" || tx.status === "scheduled") && !tx.plan_id && (
                        <Button variant="secondary" size="sm" className={ROW_ACTION} onClick={() => setPaying(tx)}>
                          Μερική πληρωμή
                        </Button>
                      )}
                      {tx.status !== "paid" && (
                        <form
                          action={async () => {
                            const message = errorOf(await markPaid(tx.id));
                            if (message) window.alert(message);
                          }}
                        >
                          <Button type="submit" variant="secondary" size="sm" className={ROW_ACTION}>
                            {el.common.markPaid}
                          </Button>
                        </form>
                      )}
                      <Button variant="secondary" size="sm" className={ROW_ACTION} onClick={() => setTarget(tx)}>
                        {el.common.edit}
                      </Button>
                      <Button
                        variant="danger"
                        size="sm"
                        className={ROW_ACTION}
                        disabled={deleting === tx.id}
                        onClick={() => handleDelete(tx)}
                      >
                        {deleting === tx.id ? "…" : el.common.delete}
                      </Button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {visibleTransactions.length === 0 && (
              <tr className="block md:table-row">
                <td colSpan={7} className="block border-b border-hairline py-8 text-sm text-muted md:table-cell md:px-3">
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
