"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { formatMoney, formatDate } from "@/lib/format";
import { el } from "@/lib/i18n/el";
import {
  AiSpark,
  Badge,
  Button,
  Input,
  PageHeader,
  SpecTable,
  StatusDot,
  Td,
  Th,
  Tr,
  buttonClass,
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

// Spec-sheet cells (SpecTable's Th/Td). Below md each row is a CSS grid
// (a card) and the cells are blocks placed in it, without the table's
// rules and padding; from md up they are ordinary spec-table cells.
const TH = "sticky top-0 z-10 bg-canvas";
const CARD = "block max-md:border-b-0 max-md:p-0 md:table-cell";

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

export function TransactionsTable({
  transactions,
  contacts,
  projects,
  categories,
  accounts,
  filters,
  pager,
  pageTotalsOnly = false,
  exportHref,
  startCreating = false,
}: {
  transactions: TxRow[];
  contacts: Option[];
  projects: Option[];
  categories: Option[];
  accounts: Option[];
  filters?: React.ReactNode;
  // «Σελίδα 2 από 14» with previous / next links (server-built).
  pager?: React.ReactNode;
  // More than one page: the sums are this page's, and say so.
  pageTotalsOnly?: boolean;
  exportHref?: string;
  startCreating?: boolean;
}) {
  // Exactly one modal instance for the whole table, whichever row (or
  // "create") is active -- not one per row. `key` forces a clean remount
  // when switching targets, so stale form state never leaks between rows.
  const [target, setTarget] = useState<"create" | TxRow | null>(startCreating ? "create" : null);
  const [paying, setPaying] = useState<TxRow | null>(null);
  // The search lives in the URL (?q=) and runs on the server over every
  // matching row (lib/data/txSearch), so it works across pages. Typing
  // updates the URL after a short pause and goes back to page 1.
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const urlQuery = searchParams.get("q") ?? "";
  const [search, setSearch] = useState(urlQuery);
  const lastSent = useRef(urlQuery);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [loadingSource, setLoadingSource] = useState<string | null>(null);

  useEffect(() => {
    const q = search.trim();
    if (q === lastSent.current) return;
    const timer = setTimeout(() => {
      lastSent.current = q;
      const next = new URLSearchParams(searchParams.toString());
      if (q) next.set("q", q);
      else next.delete("q");
      next.delete("page");
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    }, 400);
    return () => clearTimeout(timer);
  }, [search, searchParams, pathname, router]);

  const visibleTransactions = transactions;

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
              <a href={exportHref} className={buttonClass("secondary", "md")}>
                Εξαγωγή CSV
              </a>
            )}
            <Button onClick={() => setTarget("create")}>
              + Νέα Κίνηση
            </Button>
          </>
        }
      />

      {filters}

      <div className="flex flex-col gap-3 md:flex-row md:flex-wrap md:items-center md:justify-between md:gap-6">
        <Input
          type="search"
          placeholder="Αναζήτηση σε όλες τις κινήσεις: επαφή, έργο, κατηγορία, περιγραφή, αρ. παραστατικού…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full max-md:min-h-11 md:max-w-md md:flex-1"
        />
        <p className="flex flex-wrap items-baseline gap-x-6 gap-y-1 text-small text-muted">
          {pageTotalsOnly && <span className="eyebrow">Σύνολα της σελίδας</span>}
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
          cards on a phone. Never rendered twice. */}
      <div className="md:max-h-[70vh] md:overflow-auto">
        <SpecTable frame="none" tableClassName="block md:table">
          <thead className="hidden md:table-header-group">
            <tr>
              <Th className={TH}>{el.transaction.date}</Th>
              <Th className={TH}>{el.transaction.contact}</Th>
              <Th className={TH}>{el.transaction.project}</Th>
              <Th className={TH}>{el.transaction.category}</Th>
              <Th numeric className={TH}>
                {el.transaction.grossAmount}
              </Th>
              <Th className={TH}>{el.transaction.status}</Th>
              <Th className={TH}></Th>
            </tr>
          </thead>
          <tbody className="block border-t border-rule md:table-row-group md:border-t-0">
            {visibleTransactions.map((tx) => {
              const overdue = isOverdue(tx);
              return (
                <Tr
                  key={tx.id}
                  className={`grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1 border-b border-hairline py-3 md:table-row md:border-b-0 md:py-0 ${
                    overdue ? "border-l-2 border-l-negative pl-3 md:border-l-0 md:pl-0" : ""
                  }`}
                >
                  <Td
                    className={`${CARD} col-start-1 row-start-1 max-md:text-small max-md:text-muted ${
                      overdue ? "md:border-l-2 md:border-l-negative" : ""
                    }`}
                  >
                    <span className="num">{formatDate(tx.tx_date)}</span>
                  </Td>
                  <Td className={`${CARD} col-start-1 row-start-2 min-w-0 max-md:text-ink md:text-ink`}>
                    <span className="inline-flex items-center gap-1.5 md:whitespace-nowrap">
                      {tx.contact_name ?? "—"}
                      {AI_ORIGINS.has(tx.origin ?? "") && (
                        <span title="Καταχωρήθηκε μέσω AI, επιβεβαιωμένη από άνθρωπο πριν καταγραφεί">
                          <AiSpark className="text-ai" />
                        </span>
                      )}
                    </span>
                  </Td>
                  <Td className={`${CARD} col-span-2 col-start-1 row-start-3 max-md:text-small max-md:text-muted md:whitespace-nowrap`}>
                    <span className="md:hidden">{el.transaction.project} · </span>
                    {tx.project_name ?? "—"}
                  </Td>
                  <Td className={`${CARD} col-span-2 col-start-1 row-start-4 max-md:text-small max-md:text-muted md:whitespace-nowrap`}>
                    <span className="md:hidden">{el.transaction.category} · </span>
                    {tx.category_name ?? "—"}
                  </Td>
                  <Td numeric className={`${CARD} col-start-2 row-start-1 max-md:text-ink md:text-ink`}>
                    {tx.direction === "income" ? "+" : "−"}
                    {formatMoney(tx.gross_amount)}
                  </Td>
                  <Td className={`${CARD} col-start-2 row-start-2 justify-self-end md:justify-self-auto`}>
                    <div className="flex flex-wrap items-center justify-end gap-1.5 md:justify-start">
                      <StatusDot
                        tone={STATUS_TONE[tx.status as keyof typeof STATUS_TONE]}
                        label={STATUS_LABEL[tx.status as keyof typeof STATUS_LABEL]}
                      />
                      {overdue && <Badge tone="negative">εκπρόθεσμη</Badge>}
                    </div>
                  </Td>
                  <Td className={`${CARD} col-span-2 col-start-1 row-start-5 max-md:pt-2 md:py-1.5`}>
                    <div className="flex flex-wrap items-center gap-2 md:flex-nowrap md:justify-end">
                      {tx.has_source_document && (
                        <Button
                          variant="secondary"
                          size="sm"
                          disabled={loadingSource === tx.id}
                          onClick={() => handleViewSource(tx)}
                        >
                          {loadingSource === tx.id ? "…" : "Πρωτότυπο"}
                        </Button>
                      )}
                      {(tx.status === "pending" || tx.status === "scheduled") && !tx.plan_id && (
                        <Button variant="secondary" size="sm" onClick={() => setPaying(tx)}>
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
                          <Button type="submit" variant="secondary" size="sm">
                            {el.common.markPaid}
                          </Button>
                        </form>
                      )}
                      <Button variant="secondary" size="sm" onClick={() => setTarget(tx)}>
                        {el.common.edit}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={deleting === tx.id}
                        onClick={() => handleDelete(tx)}
                        className="text-negative hover:text-negative"
                      >
                        {deleting === tx.id ? "…" : el.common.delete}
                      </Button>
                    </div>
                  </Td>
                </Tr>
              );
            })}
            {visibleTransactions.length === 0 && (
              <tr className="block md:table-row">
                <Td colSpan={7} className="block py-8 max-md:px-0 max-md:text-muted md:table-cell md:text-muted">
                  {transactions.length === 0
                    ? "Δεν υπάρχουν ακόμα κινήσεις. Πατήστε «+ Νέα Κίνηση» για να ξεκινήσετε."
                    : "Καμία κίνηση δεν ταιριάζει με την αναζήτηση."}
                </Td>
              </tr>
            )}
          </tbody>
        </SpecTable>
      </div>

      {pager}

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
