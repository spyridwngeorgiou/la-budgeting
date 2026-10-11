import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { el } from "@/lib/i18n/el";
import { formatDate, formatMoney } from "@/lib/format";
import { AiSpark, FilterChip, Notice, buttonClass } from "@/components/ui";
import { TransactionsTable } from "./TransactionsTable";
import { TransactionFilters } from "./TransactionFilters";
import { TX_STATUS, TX_DIRECTION, type TxStatus, type TxDirection } from "@/lib/domain/enums";
import { loadLookups } from "@/lib/data/lookups";
import { txSearchFilter } from "@/lib/data/txSearch";
import { getCurrentOrgId } from "@/lib/supabase/org";
import { withParams } from "@/lib/url";

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

export default async function TransactionsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const status = parseStatus(params.status);
  const direction = parseDirection(params.direction);
  const projectId = params.project_id || null;
  const accountId = params.account_id || null;
  const contactId = params.contact_id || null;
  const categoryId = params.category_id || null;
  const scope = params.scope === "business" || params.scope === "personal" ? params.scope : null;
  const from = params.from || null;
  const to = params.to || null;
  // Explicit id list -- used by the AI assistant's drill-down link, where
  // the relevant rows don't share a single common filter (e.g. "every
  // transaction that made up this answer" can span several projects/months).
  const ids = params.ids ? params.ids.split(",").filter(Boolean) : null;
  const supabase = await createClient();
  const orgId = await getCurrentOrgId(supabase);

  // Drill-down entry points: dashboard/project/analysis KPI cells link here
  // with project_id / account_id / contact_id / category_id / scope / from /
  // to so any figure shown elsewhere is one click away from the actual rows
  // behind it, not just a total you have to trust.
  const PAGE_SIZE = 50;
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
  const rows = (transactions ?? []).map((tx) => {
    const contact = Array.isArray(tx.contacts) ? tx.contacts[0] : tx.contacts;
    const project = Array.isArray(tx.projects) ? tx.projects[0] : tx.projects;
    const category = Array.isArray(tx.categories) ? tx.categories[0] : tx.categories;
    return {
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
      contact_name: contact?.name ?? null,
      project_name: project?.display_name ?? null,
      category_name: category?.name ?? null,
    };
  });

  const contactOptions = (contacts ?? []).map((c) => ({ id: c.id, label: c.name }));
  const projectOptions = (projects ?? []).map((p) => ({ id: p.id, label: p.display_name }));
  const categoryOptions = (categories ?? []).map((c) => ({ id: c.id, label: c.name }));
  const accountOptions = (accounts ?? []).map((a) => ({ id: a.id, label: a.name }));

  const activeProjectName = projectId ? projectOptions.find((p) => p.id === projectId)?.label : null;
  const activeAccountName = accountId ? accountOptions.find((a) => a.id === accountId)?.label : null;
  const activeContactName = contactId ? contactOptions.find((c) => c.id === contactId)?.label : null;
  const activeCategoryName = categoryId ? categoryOptions.find((c) => c.id === categoryId)?.label : null;
  const hasDrillFilter = projectId || accountId || contactId || categoryId || scope || from || to || ids;
  const total = totalCount ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(requestedPage, pageCount);
  // A page past the end (rows deleted, filters narrowed): go to the last one.
  if (requestedPage > pageCount) redirect(withParams("/transactions", { ...params }, { page: pageCount > 1 ? String(pageCount) : null }));

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
    <div key="filter-bar" className="flex flex-col gap-4">
      <TransactionFilters
        key="entity-filters"
        current={{
          status: params.status,
          direction: params.direction,
          scope: params.scope,
          from: params.from,
          to: params.to,
          project_id: params.project_id,
          contact_id: params.contact_id,
          category_id: params.category_id,
          account_id: params.account_id,
        }}
        projects={projectOptions}
        contacts={contactOptions}
        categories={categoryOptions}
        accounts={accountOptions}
      />
      {hasDrillFilter && (
        <Notice key="drill-banner" as="div" size="small" className="flex flex-col gap-1">
          <div key="line1" className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span key="label" className="eyebrow text-muted">Ανάλυση κινήσεων:</span>
            {activeProjectName && <strong key="project" className="font-medium text-ink">{activeProjectName}</strong>}
            {activeAccountName && <strong key="account" className="font-medium text-ink">{activeAccountName}</strong>}
            {activeContactName && <strong key="contact" className="font-medium text-ink">{activeContactName}</strong>}
            {activeCategoryName && <strong key="category" className="font-medium text-ink">{activeCategoryName}</strong>}
            {scope && (
              <strong key="scope" className="font-medium text-ink">
                {scope === "business" ? "Επιχειρηματικό" : "Προσωπικό"}
              </strong>
            )}
            {(from || to) && (
              <strong key="range" className="num font-medium text-ink">
                {from ? formatDate(from) : "…"} – {to ? formatDate(to) : "…"}
              </strong>
            )}
            {status && <strong key="status" className="font-medium text-ink">({el.transaction[status]})</strong>}
            {ids && <strong key="ids" className="font-medium text-ink">Από τον Βοηθό AI</strong>}
            <Link
              key="clear"
              href="/transactions"
              className="ml-auto inline-flex min-h-11 items-center text-ink underline underline-offset-4 hover:text-navy md:min-h-0"
            >
              Καθαρισμός
            </Link>
          </div>
          {accountBalance && (
            <p key="line2" className="text-small text-muted">
              Υπόλοιπο Έναρξης {formatDate(accountBalance.opening_balance_date)}:{" "}
              <span className="num">{formatMoney(accountBalance.opening_balance)}</span> · Τρέχον Υπόλοιπο:{" "}
              <span className="num">{formatMoney(accountBalance.current_balance)}</span>. Κινήσεις πριν την ημερομηνία
              έναρξης εμφανίζονται εδώ αλλά δεν προσμετρώνται στο υπόλοιπο.
            </p>
          )}
        </Notice>
      )}
      <div key="status-chips" className="flex flex-wrap items-center gap-2">
        {["", "paid", "pending", "scheduled"].map((s) => {
          const on = status === s || (!status && !s);
          return (
            <FilterChip
              key={s || "all"}
              // Keeps the project / account / date filters already applied
              // (it used to reset to ?status= alone).
              href={withParams("/transactions", { ...params }, { status: s || null, page: null })}
              active={on}
              className="max-md:min-h-11"
            >
              {s ? el.transaction[s as "paid" | "pending" | "scheduled"] : "Όλα"}
            </FilterChip>
          );
        })}
        <Link
          key="ask-ai"
          href={`/assistant?q=${encodeURIComponent(askPrompt)}`}
          className={buttonClass("ai", "md", "ml-auto max-md:w-full max-md:whitespace-normal")}
        >
          <AiSpark />
          Ρώτα το Kansha AI γι&apos; αυτόν τον πίνακα →
        </Link>
      </div>
    </div>
  );

  // «Σελίδα 2 από 14» with previous / next: plain links that keep every
  // filter (withParams), so a page is shareable like any filter.
  const pageHref = (n: number) => withParams("/transactions", { ...params }, { page: n > 1 ? String(n) : null, new: null });
  const pager =
    pageCount > 1 ? (
      <nav key="pager" aria-label="Σελίδες κινήσεων" className="flex flex-wrap items-center justify-between gap-3 text-small text-muted">
        <span key="where">
          Σελίδα <span className="num text-ink">{page}</span> από <span className="num">{pageCount}</span> ·{" "}
          <span className="num">{(page - 1) * PAGE_SIZE + 1}</span>–<span className="num">{Math.min(page * PAGE_SIZE, total)}</span> από{" "}
          <span className="num">{total}</span> κινήσεις
        </span>
        <span key="links" className="flex gap-2">
          {page > 1 ? (
            <Link key="prev" href={pageHref(page - 1)} rel="prev" className={buttonClass("secondary", "sm")}>
              ‹ Προηγούμενη
            </Link>
          ) : null}
          {page < pageCount ? (
            <Link key="next" href={pageHref(page + 1)} rel="next" className={buttonClass("secondary", "sm")}>
              Επόμενη ›
            </Link>
          ) : null}
        </span>
      </nav>
    ) : null;

  return (
    <TransactionsTable
      pager={pager}
      pageTotalsOnly={pageCount > 1}
      transactions={rows}
      contacts={contactOptions}
      projects={projectOptions}
      categories={categoryOptions}
      accounts={accountOptions}
      filters={filterBar}
      exportHref={exportHref}
      startCreating={params.new === "1"}
    />
  );
}
