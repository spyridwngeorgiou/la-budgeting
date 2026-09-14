import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { el } from "@/lib/i18n/el";
import { formatDate, formatMoney } from "@/lib/format";
import { TransactionsTable } from "./TransactionsTable";
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
  let query = supabase
    .from("transactions")
    .select(
      "id, tx_date, description, direction, status, gross_amount, net_amount, vat_amount, vat_rate, withholding_amount, has_invoice, invoice_number, contacts(name), projects(display_name), categories(name), accounts(name)",
    )
    .order("tx_date", { ascending: false })
    .limit(500);

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

  const [{ data: transactions }, { data: contacts }, { data: projects }, { data: categories }, { data: accounts }, { data: accountBalance }] =
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
      description: tx.description,
      direction: tx.direction,
      status: tx.status,
      gross_amount: tx.gross_amount,
      net_amount: tx.net_amount,
      vat_rate: tx.vat_rate,
      withholding_amount: tx.withholding_amount,
      has_invoice: tx.has_invoice,
      invoice_number: tx.invoice_number,
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

  // Every direct child below carries an explicit `key`, even the ones that
  // aren't in a `.map()`. This JSX is built in a Server Component and passed
  // as a prop into the Client Component TransactionsTable ({filters}) --
  // crossing that RSC boundary strips React's usual "adjacent static JSX
  // children don't need keys" exemption, so without explicit keys here
  // React logs a spurious (but real, reproducible) missing-key warning on
  // every navigation to this page.
  const filterBar = (
    <div key="filter-bar" className="flex flex-col gap-2">
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
      <div key="status-chips" className="flex gap-2 text-sm">
        {["", "paid", "pending", "scheduled"].map((s) => (
          <a
            key={s || "all"}
            href={s ? `/transactions?status=${s}` : "/transactions"}
            className={`rounded px-3 py-1 ${status === s || (!status && !s) ? "bg-ink text-white" : "bg-bg"}`}
          >
            {s ? el.transaction[s as "paid" | "pending" | "scheduled"] : "Όλα"}
          </a>
        ))}
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
    />
  );
}
