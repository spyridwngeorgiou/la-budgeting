"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Paperclip } from "lucide-react";
import { formatDate } from "@/lib/format";
import { el } from "@/lib/i18n/el";
import { shell } from "@/lib/i18n/v2/shell";
import {
  AiSpark,
  Amount,
  Badge,
  Button,
  EmptyState,
  PageHeader,
  SUB_CLASS,
  SpecTable,
  StatusDot,
  Td,
  Th,
  Tr,
  buttonClass,
  cn,
  useConfirm,
  useToast,
} from "@/components/ui";
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

// One list, laid out by CSS (never rendered twice): a spec table from lg
// up, a stack of hairline cards below. With the 240px menu rail the content
// column is only 464–719px at md, too narrow for these columns, so the
// table starts at lg and the account column at xl. No inner scroll box: the
// table always fits (long words wrap anywhere) and its head sticks to the
// top of the page (separate borders, so the rule moves with the head).
const TH = "sticky top-[var(--sticky-top,0px)] z-10 bg-canvas";
const CELL = "block max-lg:border-b-0 max-lg:p-0 lg:table-cell";
const WRAP = "[overflow-wrap:anywhere]";

interface Option {
  id: string;
  label: string;
}

export interface TxRow {
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
  account_name: string | null;
  origin: string | null;
  has_source_document: boolean;
}

const rowLabel = (tx: TxRow) => tx.description || tx.contact_name || formatDate(tx.tx_date);

export function TransactionsTable({
  transactions,
  contacts,
  projects,
  categories,
  accounts,
  filters,
  pager,
  pageTotalsOnly = false,
  filtered = false,
  exportHref,
  askHref,
  startCreating = false,
  newCloseHref,
}: {
  transactions: TxRow[];
  contacts: Option[];
  projects: Option[];
  categories: Option[];
  accounts: Option[];
  // The filter row (and an ?ids= notice), server-built.
  filters?: React.ReactNode;
  // «Σελίδα 2 από 14» with previous / next links (server-built).
  pager?: React.ReactNode;
  // More than one page: the sums are this page's, and say so.
  pageTotalsOnly?: boolean;
  // A filter or search is on: an empty list means «no match», not «no data».
  filtered?: boolean;
  exportHref?: string;
  // «Ρώτα το Kansha AI γι' αυτόν τον πίνακα»: the question about these filters.
  askHref?: string;
  startCreating?: boolean;
  // Opened by ?new=1: where closing the form goes (the URL without it).
  newCloseHref?: string;
}) {
  // Exactly one drawer for the whole table, whichever row (or "create") is
  // active -- not one per row. `key` forces a clean remount when switching
  // targets, so stale form state never leaks between rows.
  const [target, setTarget] = useState<"create" | TxRow | null>(startCreating ? "create" : null);
  const [paying, setPaying] = useState<TxRow | null>(null);
  // The row action in flight («<id>:paid», «<id>:delete», «<id>:source»).
  const [busy, setBusy] = useState<string | null>(null);
  const { show } = useToast();
  const { confirm, dialog } = useConfirm();
  const router = useRouter();

  // The sums are a claim about exactly the rows on screen.
  const summary = useMemo(() => {
    let income = 0;
    let expense = 0;
    for (const tx of transactions) {
      const amount = Number(tx.gross_amount ?? 0);
      if (tx.direction === "income") income += amount;
      else expense += amount;
    }
    return { income, expense, net: income - expense, count: transactions.length };
  }, [transactions]);

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

  // A row action: errors (and the outcome) as a toast, never a browser box.
  async function run(key: string, act: () => Promise<unknown>, done: string) {
    setBusy(key);
    try {
      const message = errorOf(await act());
      if (message) show(message, { tone: "negative" });
      else show(done);
    } catch {
      show(el.common.error, { tone: "negative" });
    } finally {
      setBusy(null);
    }
  }

  async function handleViewSource(tx: TxRow) {
    setBusy(`${tx.id}:source`);
    try {
      const url = await getSourceDocumentUrl(tx.id);
      if (url) window.open(url, "_blank", "noopener,noreferrer");
      else show(el.transaction.sourceMissing, { tone: "negative" });
    } catch {
      show(el.common.error, { tone: "negative" });
    } finally {
      setBusy(null);
    }
  }

  async function handleDelete(tx: TxRow) {
    const ok = await confirm({
      message: el.transaction.deleteConfirm.replace("{label}", rowLabel(tx)),
      confirmLabel: el.common.delete,
    });
    if (ok) await run(`${tx.id}:delete`, () => deleteTransaction(tx.id), el.common.deleted);
  }

  function closeForm() {
    if (target === "create" && newCloseHref) router.replace(newCloseHref, { scroll: false });
    setTarget(null);
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={el.nav.transactions}
        meta="Το πλήρες βιβλίο εσόδων-εξόδων. Φιλτράρετε, αναζητήστε, επεξεργαστείτε."
        actions={
          <>
            {exportHref && (
              <a href={exportHref} className={buttonClass("secondary", "md")}>
                Εξαγωγή CSV
              </a>
            )}
            <Button onClick={() => setTarget("create")}>{el.transaction.newButton}</Button>
          </>
        }
      />

      {filters}

      {transactions.length === 0 ? (
        filtered ? (
          <EmptyState title={el.transaction.noMatch} body={el.transaction.noMatchHint} />
        ) : (
          <EmptyState
            title={el.transaction.empty}
            body={el.transaction.emptyHint}
            action={<Button onClick={() => setTarget("create")}>{el.transaction.newButton}</Button>}
          />
        )
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
            <p className="flex flex-wrap items-baseline gap-x-6 gap-y-1 text-small text-muted">
              {pageTotalsOnly && <span className="eyebrow">Σύνολα της σελίδας</span>}
              <span>
                <span className="num">{summary.count}</span> κίνησ{summary.count === 1 ? "η" : "εις"}
              </span>
              <span>
                Έσοδα <Amount value={summary.income} className="text-text" />
              </span>
              <span>
                Έξοδα <Amount value={-summary.expense} className="text-text" />
              </span>
              <span>
                Καθαρό <Amount value={summary.net} className="font-medium text-ink" />
              </span>
            </p>
            {askHref && (
              <Link href={askHref} className={buttonClass("ai", "md", "max-md:w-full max-md:whitespace-normal")}>
                <AiSpark />
                Ρώτα το Kansha AI γι&apos; αυτόν τον πίνακα →
              </Link>
            )}
          </div>

          <SpecTable frame="none" tableClassName="block border-separate border-spacing-0 lg:table">
            <thead className="hidden lg:table-header-group">
              <tr>
                <Th className={TH}>{el.transaction.date}</Th>
                <Th className={TH}>{el.transaction.description}</Th>
                <Th className={TH}>{el.transaction.project}</Th>
                <Th className={TH}>{el.transaction.category}</Th>
                <Th className={cn(TH, "hidden xl:table-cell")}>{el.transaction.accountColumn}</Th>
                <Th numeric className={TH}>
                  {el.transaction.amount}
                </Th>
                <Th className={TH}>{el.transaction.status}</Th>
                <Th className={TH}>
                  <span className="sr-only">{shell.ui.actions}</span>
                </Th>
              </tr>
            </thead>
            <tbody className="block border-t border-rule lg:table-row-group lg:border-t-0">
              {transactions.map((tx) => {
                const overdue = isOverdue(tx);
                const awaiting = tx.status === "pending" || tx.status === "scheduled";
                const gross = Number(tx.gross_amount ?? 0);
                const meta = [tx.project_name, tx.category_name, tx.account_name].filter(Boolean).join(" · ");
                return (
                  <Tr
                    key={tx.id}
                    className={cn(
                      "grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1 border-b border-hairline py-3 lg:table-row lg:border-b-0 lg:py-0",
                      overdue && "border-l-2 border-l-negative pl-3 lg:border-l-0 lg:pl-0",
                    )}
                  >
                    <Td
                      className={cn(
                        CELL,
                        "col-start-1 row-start-1 max-lg:text-small max-lg:text-muted lg:whitespace-nowrap",
                        overdue && "lg:border-l-2 lg:border-l-negative lg:first:pl-2",
                      )}
                    >
                      <span className="num">{formatDate(tx.tx_date)}</span>
                    </Td>
                    <Td className={cn(CELL, "col-start-1 row-start-2 min-w-0 lg:min-w-40", WRAP)}>
                      <span className="text-ink">{tx.description || tx.contact_name || "—"}</span>
                      {AI_ORIGINS.has(tx.origin ?? "") && (
                        <span title="Καταχωρήθηκε μέσω AI, επιβεβαιωμένη από άνθρωπο πριν καταγραφεί" className="ml-1.5 inline-block">
                          <AiSpark className="text-ai" />
                        </span>
                      )}
                      {tx.has_source_document && (
                        <button
                          type="button"
                          onClick={() => handleViewSource(tx)}
                          disabled={busy === `${tx.id}:source`}
                          aria-label={el.transaction.source}
                          title={el.transaction.source}
                          className="-my-1.5 ml-1 inline-flex h-8 w-8 items-center justify-center align-middle text-muted hover:bg-hover hover:text-ink disabled:opacity-50 pointer-coarse:-my-3 pointer-coarse:h-11 pointer-coarse:w-11"
                        >
                          <Paperclip className="h-4 w-4" strokeWidth={1.5} aria-hidden />
                        </button>
                      )}
                      {tx.description && tx.contact_name && <span className={SUB_CLASS}>{tx.contact_name}</span>}
                      {meta && <span className={cn(SUB_CLASS, "lg:hidden")}>{meta}</span>}
                    </Td>
                    <Td className={cn("hidden lg:table-cell", WRAP)}>{tx.project_name ?? "—"}</Td>
                    <Td className={cn("hidden lg:table-cell", WRAP)}>{tx.category_name ?? "—"}</Td>
                    <Td className={cn("hidden xl:table-cell", WRAP)}>{tx.account_name ?? "—"}</Td>
                    <Td numeric strong className={cn(CELL, "col-start-2 row-start-2")}>
                      <Amount value={tx.direction === "income" ? gross : -gross} />
                    </Td>
                    <Td className={cn(CELL, "col-start-2 row-start-1 justify-self-end lg:justify-self-auto")}>
                      <span className="flex flex-wrap items-center justify-end gap-1.5 lg:justify-start">
                        <StatusDot
                          tone={STATUS_TONE[tx.status as keyof typeof STATUS_TONE]}
                          label={STATUS_LABEL[tx.status as keyof typeof STATUS_LABEL]}
                          className="whitespace-nowrap"
                        />
                        {overdue && <Badge tone="negative">εκπρόθεσμη</Badge>}
                      </span>
                    </Td>
                    <Td className={cn(CELL, "col-span-2 col-start-1 row-start-3 max-lg:pt-2 lg:py-2")}>
                      <div className="flex flex-wrap items-center gap-2 lg:justify-end">
                        {/* Paid / partly paid: only while the row still awaits payment. */}
                        {awaiting && (
                          <Button
                            variant="secondary"
                            size="sm"
                            disabled={busy === `${tx.id}:paid`}
                            onClick={() => run(`${tx.id}:paid`, () => markPaid(tx.id), el.common.saved)}
                          >
                            {busy === `${tx.id}:paid` ? "…" : el.common.markPaid}
                          </Button>
                        )}
                        {awaiting && !tx.plan_id && (
                          <Button variant="ghost" size="sm" onClick={() => setPaying(tx)}>
                            {el.transaction.partial}
                          </Button>
                        )}
                        <Button variant="ghost" size="sm" onClick={() => setTarget(tx)}>
                          {el.common.edit}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={busy === `${tx.id}:delete`}
                          onClick={() => handleDelete(tx)}
                          className="text-negative hover:text-negative"
                        >
                          {busy === `${tx.id}:delete` ? "…" : el.common.delete}
                        </Button>
                      </div>
                    </Td>
                  </Tr>
                );
              })}
            </tbody>
          </SpecTable>
        </>
      )}

      {pager}

      {target && (
        <TransactionFormModal
          key={target === "create" ? "create" : target.id}
          action={target === "create" ? createTransaction : (formData) => updateTransaction(target.id, formData)}
          contacts={contacts}
          projects={projects}
          categories={categories}
          accounts={accounts}
          initial={target === "create" ? undefined : initialFor(target)}
          eyebrow={target === "create" ? undefined : rowLabel(target)}
          onClose={closeForm}
        />
      )}

      {paying && (
        <PartialPaymentModal
          key={paying.id}
          transactionId={paying.id}
          label={rowLabel(paying)}
          remaining={Number(paying.gross_amount ?? 0)}
          accountId={paying.account_id}
          accounts={accounts}
          onClose={() => setPaying(null)}
        />
      )}

      {dialog}
    </div>
  );
}
