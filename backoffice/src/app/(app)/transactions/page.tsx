import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { el } from "@/lib/i18n/el";
import { formatDate, formatMoney } from "@/lib/format";
import { Notice, Pager } from "@/components/ui";
import { TransactionsTable, type TxRow } from "./TransactionsTable";
import { TransactionFilters } from "./TransactionFilters";
import { TX_STATUS, TX_DIRECTION, type TxStatus, type TxDirection } from "@/lib/domain/enums";
import { loadLookups } from "@/lib/data/lookups";
import { txSearchFilter } from "@/lib/data/txSearch";
import { getCurrentOrgId } from "@/lib/supabase/org";
import { withParams } from "@/lib/url";
import { TX_BASE, hasAnyFilter, txFilterHref, type TxParams } from "./filterHref";

function parseStatus(value: string | undefined): TxStatus | null {
  return TX_STATUS.includes(value as TxStatus) ? (value as TxStatus) : null;
}
function parseDirection(value: string | undefined): TxDirection | null {
  return TX_DIRECTION.includes(value as TxDirection) ? (value as TxDirection) : null;
}

interface SearchParams {
  status?: string;
  direction?: string;
  project_id?: string;
  account_id?: string;
  contact_id?: string;
  category_id?: string;
  scope?: string;
  from?: string;
  to?: string;
  ids?: string;
  // 1-based page of PAGE_SIZE rows (owner decision 11/10/2026: 50 a page
  // instead of up to 500 at once -- less CPU per request, usable on a phone).
  page?: string;
  // Text search, run on the server over every matching row.
  q?: string;
  // «＋ Καταχώριση» → Χειροκίνητα: open the new-movement form at once.
  new?: string;
}

const PAGE_SIZE = 50;

export default async function TransactionsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  // Every param as plain values, for the filter row, the pager and the
  // links: whatever changes one filter keeps the rest (the search too).
  const all: TxParams = { ...params };
  const status = parseStatus(params.status);
  const direction = parseDirection(params.direction);
  const projectId = params.project_id || null;
  const accountId = params.account_id || null;
  const contactId = params.contact_id || null;
  const categoryId = params.category_id || null;
  const scope = params.scope === "business" || params.scope === "personal" ? params.scope : null;
  const from = params.from || null;
  const to = params.to || null;
  // Explicit id list -- used by the AI assistant's drill-down link and an
  // account's ledger row, where the rows don't share a single filter.
  const ids = params.ids ? params.ids.split(",").filter(Boolean) : null;
  const supabase = await createClient();
  const orgId = await getCurrentOrgId(supabase);

  // Drill-down entry points: dashboard/project/analysis KPI cells link here
  // with project_id / account_id / contact_id / category_id / scope / from /
  // to so any figure shown elsewhere is one click away from the actual rows
  // behind it, not just a total you have to trust.
  const requestedPage = Math.max(1, Math.floor(Number(params.page) || 1));
  // count: "exact" alongside the row fetch, so the page knows how many
  // pages there are and says so -- rows are never silently cut off.
  let query = supabase
    .from("transactions")
    .select(
      "id, tx_date, due_date, paid_on, plan_id, property_project_id, description, direction, status, scope, gross_amount, net_amount, vat_amount, vat_rate, withholding_amount, has_invoice, invoice_number, contact_id, project_id, category_id, account_id, origin, source_document_id, contacts(name), projects(display_name), categories(name), accounts(name)",
      { count: "exact" },
    )
    .eq("org_id", orgId)
    .order("tx_date", { ascending: false })
    // A stable order inside one day, so paging never repeats or skips a row.
    .order("id", { ascending: false })
    .range((requestedPage - 1) * PAGE_SIZE, requestedPage * PAGE_SIZE - 1);

  if (status) query = query.eq("status", status);
  if (direction) query = query.eq("direction", direction);
  if (projectId) query = query.eq("project_id", projectId);
  if (accountId) query = query.eq("account_id", accountId);
  if (contactId) query = query.eq("contact_id", contactId);
  if (categoryId) query = query.eq("category_id", categoryId);
  if (scope) query = query.eq("scope", scope);
  if (from) query = query.gte("tx_date", from);
  if (to) query = query.lte("tx_date", to);
  if (ids) query = query.in("id", ids);
  // Text search over every matching row, not just this page (lib/data/txSearch).
  const searchFilter = await txSearchFilter(supabase, orgId, params.q);
  if (searchFilter) query = query.or(searchFilter);

  const [{ data: transactions, count: totalCount }, { contacts, projects, categories, accounts }, { data: accountBalance }] =
    await Promise.all([
      query,
      loadLookups(supabase, orgId),
      accountId
        ? supabase.from("v_account_balances").select("*").eq("org_id", orgId).eq("account_id", accountId).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);

  // Flatten embedded relations here (server-side, once) rather than passing
  // the raw {contacts: {...}} shape down -- the client table only needs the
  // display name, not the whole embed machinery.
  const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);
  const rows: TxRow[] = (transactions ?? []).map((tx) => ({
    id: tx.id,
    tx_date: tx.tx_date,
    due_date: tx.due_date,
    paid_on: tx.paid_on,
    plan_id: tx.plan_id,
    property_project_id: tx.property_project_id,
    description: tx.description,
    direction: tx.direction,
    status: tx.status,
    scope: tx.scope,
    gross_amount: tx.gross_amount,
    net_amount: tx.net_amount,
    vat_rate: tx.vat_rate,
    withholding_amount: tx.withholding_amount,
    has_invoice: tx.has_invoice,
    invoice_number: tx.invoice_number,
    contact_id: tx.contact_id,
    project_id: tx.project_id,
    category_id: tx.category_id,
    account_id: tx.account_id,
    origin: tx.origin,
    has_source_document: tx.source_document_id != null,
    contact_name: one(tx.contacts)?.name ?? null,
    project_name: one(tx.projects)?.display_name ?? null,
    category_name: one(tx.categories)?.name ?? null,
    account_name: one(tx.accounts)?.name ?? null,
  }));

  const contactOptions = (contacts ?? []).map((c) => ({ id: c.id, label: c.name }));
  const projectOptions = (projects ?? []).map((p) => ({ id: p.id, label: p.display_name }));
  const categoryOptions = (categories ?? []).map((c) => ({ id: c.id, label: c.name }));
  const accountOptions = (accounts ?? []).map((a) => ({ id: a.id, label: a.name }));

  const activeProjectName = projectId ? projectOptions.find((p) => p.id === projectId)?.label : null;
  const activeAccountName = accountId ? accountOptions.find((a) => a.id === accountId)?.label : null;
  const activeContactName = contactId ? contactOptions.find((c) => c.id === contactId)?.label : null;
  const activeCategoryName = categoryId ? categoryOptions.find((c) => c.id === categoryId)?.label : null;
  const total = totalCount ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(requestedPage, pageCount);
  // A page past the end (rows deleted, filters narrowed): go to the last one.
  if (requestedPage > pageCount) redirect(withParams(TX_BASE, all, { page: pageCount > 1 ? String(pageCount) : null }));

  // Same filters as the on-screen table, but the export route itself has no
  // row cap and no paging -- "export what I'm looking at" always gets every
  // matching row, not just this page.
  const exportParams = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (typeof v === "string" && v && k !== "page" && k !== "new") exportParams.set(k, v);
  }
  const exportHref = `/api/transactions/export?${exportParams.toString()}`;

  // Plain-language summary of the active filters, fed to the assistant as
  // its opening question -- "ask about this table" should mean the table
  // the user is actually looking at, not a generic "tell me about
  // transactions" that ignores every filter they picked.
  const filterDescriptions = [
    activeProjectName && `έργο ${activeProjectName}`,
    activeAccountName && `λογαριασμό ${activeAccountName}`,
    activeContactName && `επαφή ${activeContactName}`,
    activeCategoryName && `κατηγορία ${activeCategoryName}`,
    scope && (scope === "business" ? "επιχειρηματικό πεδίο" : "προσωπικό πεδίο"),
    status && `κατάσταση ${el.transaction[status]}`,
    (from || to) && `περίοδο ${from ? formatDate(from) : "…"} έως ${to ? formatDate(to) : "…"}`,
  ].filter(Boolean);
  const askPrompt =
    filterDescriptions.length > 0
      ? `Ανάλυσε τις κινήσεις με φίλτρα: ${filterDescriptions.join(", ")}. Τι ξεχωρίζει;`
      : "Ανάλυσε τις πρόσφατες κινήσεις. Τι ξεχωρίζει;";

  // Every direct child below carries an explicit `key`, even the ones that
  // aren't in a `.map()`. This JSX is built in a Server Component and passed
  // as a prop into the Client Component TransactionsTable ({filters}) --
  // crossing that RSC boundary strips React's usual "adjacent static JSX
  // children don't need keys" exemption, so without explicit keys here
  // React logs a spurious (but real, reproducible) missing-key warning on
  // every navigation to this page.
  const filterBar = (
    <div key="filter-bar" className="flex flex-col gap-3">
      <TransactionFilters
        key="filters"
        params={all}
        projects={projectOptions}
        categories={categoryOptions}
        accounts={accountOptions}
        contactName={activeContactName ?? null}
      />
      {/* The drill-down notice: only for an explicit ?ids= list (every other
          filter is visible in the row above). */}
      {ids && (
        <Notice key="ids" as="div" size="small" className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span key="text">{el.transaction.selected.replace("{n}", String(total))}</span>
          <Link
            key="all"
            href={txFilterHref(all, { ids: null })}
            className="inline-flex min-h-11 items-center text-ink underline underline-offset-4 hover:text-navy md:min-h-0"
          >
            {el.transaction.showAll}
          </Link>
        </Notice>
      )}
      {accountBalance && (
        <p key="balance" className="text-small text-muted">
          Υπόλοιπο έναρξης {formatDate(accountBalance.opening_balance_date)}:{" "}
          <span className="num">{formatMoney(accountBalance.opening_balance)}</span> · Τρέχον υπόλοιπο:{" "}
          <span className="num">{formatMoney(accountBalance.current_balance)}</span>. Κινήσεις πριν την ημερομηνία έναρξης
          εμφανίζονται εδώ αλλά δεν προσμετρώνται στο υπόλοιπο.
        </p>
      )}
    </div>
  );

  return (
    <TransactionsTable
      pager={
        <Pager
          key="pager"
          page={page}
          pageSize={PAGE_SIZE}
          total={total}
          noun="κινήσεις"
          basePath={TX_BASE}
          params={all}
          label="Σελίδες κινήσεων"
        />
      }
      pageTotalsOnly={pageCount > 1}
      filtered={hasAnyFilter(all)}
      transactions={rows}
      contacts={contactOptions}
      projects={projectOptions}
      categories={categoryOptions}
      accounts={accountOptions}
      filters={filterBar}
      exportHref={exportHref}
      askHref={`/assistant?q=${encodeURIComponent(askPrompt)}`}
      startCreating={params.new === "1"}
      newCloseHref={params.new === "1" ? withParams(TX_BASE, all, { new: null }) : undefined}
    />
  );
}
