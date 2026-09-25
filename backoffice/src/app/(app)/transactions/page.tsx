import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { el } from "@/lib/i18n/el";
import { formatDate, formatMoney } from "@/lib/format";
import { AiSpark } from "@/components/ui";
import { TransactionsTable } from "./TransactionsTable";
import { TransactionFilters } from "./TransactionFilters";
import { TX_STATUS, TX_DIRECTION, type TxStatus, type TxDirection } from "@/lib/domain/enums";

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

  // Drill-down entry points: dashboard/project/analysis KPI cells link here
  // with project_id / account_id / contact_id / category_id / scope / from /
  // to so any figure shown elsewhere is one click away from the actual rows
  // behind it, not just a total you have to trust.
  const ROW_LIMIT = 500;
  // count: "exact" alongside the row fetch -- otherwise a filtered set with
  // more than ROW_LIMIT matches would silently drop rows off the end with
  // no indication anything was cut, which is a worse failure mode than an
  // error: nothing tells the user the total is wrong.
  let query = supabase
    .from("transactions")
    .select(
      "id, tx_date, due_date, paid_on, plan_id, property_project_id, description, direction, status, scope, gross_amount, net_amount, vat_amount, vat_rate, withholding_amount, has_invoice, invoice_number, contact_id, project_id, category_id, account_id, origin, source_document_id, contacts(name), projects(display_name), categories(name), accounts(name)",
      { count: "exact" },
    )
    .order("tx_date", { ascending: false })
    .limit(ROW_LIMIT);

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

  const [{ data: transactions, count: totalCount }, { data: contacts }, { data: projects }, { data: categories }, { data: accounts }, { data: accountBalance }] =
    await Promise.all([
      query,
      supabase.from("contacts").select("id, name").order("name"),
      supabase.from("projects").select("id, display_name").order("sort_order"),
      supabase.from("categories").select("id, name").order("sort_order"),
      supabase.from("accounts").select("id, name").order("sort_order"),
      accountId
        ? supabase.from("v_account_balances").select("*").eq("account_id", accountId).maybeSingle()
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
  const isTruncated = (totalCount ?? 0) > ROW_LIMIT;

  // Same filters as the on-screen table, but the export route itself has no
  // row cap -- "export what I'm looking at" always gets everything, not
  // just the first 500.
  const exportParams = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (typeof v === "string" && v) exportParams.set(k, v);
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
    <div key="filter-bar" className="flex flex-col gap-2">
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
      {isTruncated && (
        <div key="truncated-banner" className="rounded-md border border-amber-ink/40 bg-amber-bg px-3 py-2 text-sm text-amber-ink">
          Δείχνονται μόνο οι πρώτες {ROW_LIMIT} από {totalCount} κινήσεις που ταιριάζουν. Περιορίστε με φίλτρα
          (ημερομηνία, έργο, κατηγορία…) για να δείτε τις υπόλοιπες.
        </div>
      )}
      {hasDrillFilter && (
        <div key="drill-banner" className="flex flex-col gap-1 rounded-md bg-sage px-3 py-2 text-sm text-sage-ink">
          <div key="line1" className="flex flex-wrap items-center gap-2">
            <span key="label">Ανάλυση κινήσεων:</span>
            {activeProjectName && <strong key="project">{activeProjectName}</strong>}
            {activeAccountName && <strong key="account">{activeAccountName}</strong>}
            {activeContactName && <strong key="contact">{activeContactName}</strong>}
            {activeCategoryName && <strong key="category">{activeCategoryName}</strong>}
            {scope && <strong key="scope">{scope === "business" ? "Επιχειρηματικό" : "Προσωπικό"}</strong>}
            {(from || to) && (
              <strong key="range">
                {from ? formatDate(from) : "…"} – {to ? formatDate(to) : "…"}
              </strong>
            )}
            {status && <strong key="status">({el.transaction[status]})</strong>}
            {ids && <strong key="ids">Από τον Βοηθό AI</strong>}
            <Link key="clear" href="/transactions" className="ml-auto underline">
              Καθαρισμός
            </Link>
          </div>
          {accountBalance && (
            <div key="line2" className="text-xs opacity-80">
              Υπόλοιπο Έναρξης {formatDate(accountBalance.opening_balance_date)}:{" "}
              {formatMoney(accountBalance.opening_balance)} · Τρέχον Υπόλοιπο:{" "}
              {formatMoney(accountBalance.current_balance)}. Κινήσεις πριν την ημερομηνία έναρξης
              εμφανίζονται εδώ αλλά δεν προσμετρώνται στο υπόλοιπο.
            </div>
          )}
        </div>
      )}
      <div key="status-chips" className="flex flex-wrap items-center gap-2 text-sm">
        {["", "paid", "pending", "scheduled"].map((s) => (
          <a
            key={s || "all"}
            href={s ? `/transactions?status=${s}` : "/transactions"}
            className={`rounded px-3 py-1 ${status === s || (!status && !s) ? "bg-ink text-white" : "bg-bg"}`}
          >
            {s ? el.transaction[s as "paid" | "pending" | "scheduled"] : "Όλα"}
          </a>
        ))}
        <Link
          key="ask-ai"
          href={`/assistant?q=${encodeURIComponent(askPrompt)}`}
          className="ml-auto flex items-center gap-1.5 rounded-full border border-ai-border bg-ai-bg px-3 py-1 text-ai-ink hover:bg-ai-border/40"
        >
          <AiSpark />
          Ρώτα το Kansha AI γι&apos; αυτόν τον πίνακα →
        </Link>
      </div>
    </div>
  );

  return (
    <TransactionsTable
      transactions={rows}
      contacts={contactOptions}
      projects={projectOptions}
      categories={categoryOptions}
      accounts={accountOptions}
      filters={filterBar}
      exportHref={exportHref}
    />
  );
}
