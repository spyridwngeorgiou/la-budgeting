import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/format";
import { AiSpark } from "@/components/ui";
import { TransactionsTable } from "./TransactionsTable";
import { TX_DIRECTION, type TxDirection } from "@/lib/domain/enums";

// Κινήσεις -- ONLY what has happened: paid and received money. Anything that
// is still to happen (pending / scheduled, including "I may pay 10k the day
// after tomorrow") lives in /planned (Προγραμματισμένα) and never shows here.
// When a planned item is paid it becomes status 'paid' and appears here.
//
// Default view: the current month, with where the money stands today and what
// was spent, by project and by category. Drill-down links from elsewhere
// (project, account, contact, category, ids, from/to) show all matching paid
// rows instead of a single month.

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
  month?: string; // YYYY-MM
  span?: string; // 1 | 3 | 6 months ending at `month`
}

const eur = new Intl.NumberFormat("el-GR", { maximumFractionDigits: 0 });
const money = (n: number) => `${eur.format(Math.round(n))} €`;
const addMonths = (m: string, n: number) => {
  const [y, mo] = m.split("-").map(Number);
  return new Date(Date.UTC(y, mo - 1 + n, 1)).toISOString().slice(0, 7);
};
const monthName = (m: string) =>
  new Date(`${m}-01T00:00:00Z`).toLocaleDateString("el-GR", { month: "long", year: "numeric", timeZone: "UTC" });
const lastDay = (m: string) => new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0)).toISOString().slice(0, 10);

export default async function TransactionsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;

  // Links that still ask for open items belong to the planned page now.
  if (params.status === "pending" || params.status === "scheduled") {
    const q = new URLSearchParams(Object.entries(params).filter(([, v]) => typeof v === "string") as [string, string][]);
    q.delete("status");
    redirect(`/planned${q.toString() ? `?${q}` : ""}`);
  }

  const direction = parseDirection(params.direction);
  const projectId = params.project_id || null;
  const accountId = params.account_id || null;
  const contactId = params.contact_id || null;
  const categoryId = params.category_id || null;
  const scope = params.scope === "business" || params.scope === "personal" ? params.scope : null;
  const ids = params.ids ? params.ids.split(",").filter(Boolean) : null;
  const isDrill = !!(projectId || accountId || contactId || categoryId || scope || ids || params.from || params.to);

  const today = new Date().toISOString().slice(0, 10);
  const month = /^\d{4}-\d{2}$/.test(params.month ?? "") ? params.month! : today.slice(0, 7);
  const span = [1, 3, 6].includes(Number(params.span)) ? Number(params.span) : 1;
  const from = isDrill ? params.from || null : `${addMonths(month, 1 - span)}-01`;
  const to = isDrill ? params.to || null : lastDay(month) < today ? lastDay(month) : today;

  const supabase = await createClient();
  let query = supabase
    .from("transactions")
    .select(
      "id, tx_date, paid_on, description, direction, status, scope, gross_amount, net_amount, vat_amount, vat_rate, withholding_amount, has_invoice, invoice_number, contacts(name), projects(display_name), categories(name), accounts(name)",
    )
    .eq("status", "paid")
    .order("tx_date", { ascending: false })
    .limit(2000);
  if (direction) query = query.eq("direction", direction);
  if (projectId) query = query.eq("project_id", projectId);
  if (accountId) query = query.eq("account_id", accountId);
  if (contactId) query = query.eq("contact_id", contactId);
  if (categoryId) query = query.eq("category_id", categoryId);
  if (scope) query = query.eq("scope", scope);
  if (from) query = query.gte("tx_date", from);
  if (to) query = query.lte("tx_date", to);
  if (ids) query = query.in("id", ids);

  const [{ data: transactions }, { data: balances }, { data: planned }, { data: contacts }, { data: projects }, { data: categories }, { data: accounts }] =
    await Promise.all([
      query,
      supabase.from("v_account_balances").select("current_balance, is_liquid, kind"),
      supabase.from("transactions").select("gross_amount, due_date, tx_date").eq("direction", "expense").in("status", ["pending", "scheduled"]).lte("tx_date", lastDay(today.slice(0, 7))),
      supabase.from("contacts").select("id, name").order("name"),
      supabase.from("projects").select("id, display_name").order("sort_order"),
      supabase.from("categories").select("id, name").order("sort_order"),
      supabase.from("accounts").select("id, name").order("sort_order"),
    ]);

  const one = <T,>(x: T | T[] | null | undefined) => (Array.isArray(x) ? x[0] : x) ?? null;
  const rows = (transactions ?? []).map((tx) => ({
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
    contact_name: one(tx.contacts)?.name ?? null,
    project_name: one(tx.projects)?.display_name ?? null,
    category_name: one(tx.categories)?.name ?? null,
  }));

  // Where the money stands today.
  const cash = (balances ?? []).filter((b) => b.is_liquid && b.kind === "cash").reduce((s, b) => s + Number(b.current_balance ?? 0), 0);
  const bank = (balances ?? []).filter((b) => b.is_liquid && b.kind !== "cash").reduce((s, b) => s + Number(b.current_balance ?? 0), 0);

  // What was spent, by project (personal spending on its own line) and by category.
  const spent = (transactions ?? []).filter((t) => t.direction === "expense");
  const received = (transactions ?? []).filter((t) => t.direction === "income");
  const sumBy = (list: typeof spent, key: (t: (typeof spent)[number]) => string) => {
    const m = new Map<string, number>();
    for (const t of list) m.set(key(t), (m.get(key(t)) ?? 0) + Number(t.gross_amount ?? 0));
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  };
  const byProject = sumBy(spent, (t) => (t.scope === "personal" ? "Προσωπικά" : one(t.projects)?.display_name ?? "Χωρίς έργο"));
  const byCategory = sumBy(spent, (t) => one(t.categories)?.name ?? "Χωρίς κατηγορία");
  const spentTotal = spent.reduce((s, t) => s + Number(t.gross_amount ?? 0), 0);
  const receivedTotal = received.reduce((s, t) => s + Number(t.gross_amount ?? 0), 0);
  const byIncome = sumBy(received, (t) => one(t.contacts)?.name ?? t.description ?? "Έσοδο");

  // Bridge to the planned page: what is still due this month.
  const dueThisMonth = (planned ?? []).reduce((s, t) => s + Number(t.gross_amount ?? 0), 0);
  const overdue = (planned ?? []).filter((t) => (t.due_date ?? t.tx_date) < today).length;

  const periodLabel = isDrill
    ? `${from ? formatDate(from) : "αρχή"} – ${to ? formatDate(to) : "σήμερα"}`
    : span === 1
      ? monthName(month)
      : `${monthName(addMonths(month, 1 - span))} – ${monthName(month)}`;
  const link = (m: string, s: number) => `/transactions?month=${m}${s > 1 ? `&span=${s}` : ""}`;
  const nextMonth = addMonths(month, 1);

  // One row per item: full name, amount on one line, and a thin bar showing
  // its share of the largest item -- what weighs most is visible at a glance.
  const Breakdown = ({ title, list, total, color = "#2a78d6" }: { title: string; list: [string, number][]; total: number; color?: string }) => {
    const max = list[0]?.[1] ?? 0;
    return (
      <div className="rounded-lg border border-line bg-surface p-5">
        <div className="mb-4 flex items-baseline justify-between gap-3">
          <span className="text-xs uppercase tracking-wide text-ink-muted">{title}</span>
          <span className="whitespace-nowrap text-lg font-semibold tabular-nums">{money(total)}</span>
        </div>
        {list.length === 0 && <p className="text-sm text-ink-faint">Τίποτα αυτή την περίοδο.</p>}
        <ul className="space-y-3">
          {list.map(([k, v]) => (
            <li key={k}>
              <div className="flex items-baseline justify-between gap-4 text-sm">
                <span>{k}</span>
                <span className="whitespace-nowrap tabular-nums">
                  {money(v)}
                  <span className="ml-2 inline-block w-9 text-right text-xs text-ink-faint">{total ? Math.round((v / total) * 100) : 0}%</span>
                </span>
              </div>
              <div className="mt-1 h-1 rounded-full bg-bg">
                <div className="h-1 rounded-full" style={{ width: `${max ? (v / max) * 100 : 0}%`, background: color, opacity: 0.55 }} />
              </div>
            </li>
          ))}
        </ul>
      </div>
    );
  };

  const summary = (
    <div key="summary" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-lg font-semibold capitalize">
          {!isDrill && <Link href={link(addMonths(month, -1), span)} className="rounded px-2 text-ink-muted hover:bg-bg">‹</Link>}
          {periodLabel}
          {!isDrill && nextMonth <= today.slice(0, 7) && <Link href={link(nextMonth, span)} className="rounded px-2 text-ink-muted hover:bg-bg">›</Link>}
        </div>
        {isDrill ? (
          <Link href="/transactions" className="text-sm text-ink-muted underline">Πίσω στον μήνα</Link>
        ) : (
          <div className="flex rounded-md bg-bg p-0.5 text-xs">
            {[1, 3, 6].map((s) => (
              <Link key={s} href={link(month, s)} className={`rounded px-3 py-1 ${span === s ? "bg-surface font-medium shadow-sm" : "text-ink-muted"}`}>
                {s === 1 ? "Μήνας" : `${s} μήνες`}
              </Link>
            ))}
          </div>
        )}
      </div>

      {!isDrill && (
        <div className="grid grid-cols-3 gap-3">
          {[["Μετρητά", cash], ["Τράπεζες", bank], ["Σύνολο σήμερα", cash + bank]].map(([label, v]) => (
            <div key={label as string} className="rounded-lg border border-line bg-surface p-4">
              <div className="text-xs uppercase tracking-wide text-ink-muted">{label as string}</div>
              <div className="mt-1 text-xl font-semibold tabular-nums">{money(v as number)}</div>
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Breakdown title="Τι χάλασα · ανά έργο" list={byProject} total={spentTotal} />
        <Breakdown title="Τι χάλασα · ανά κατηγορία" list={byCategory} total={spentTotal} />
      </div>
      {receivedTotal > 0 && <Breakdown title="Τι μπήκε" list={byIncome} total={receivedTotal} color="#1baf7a" />}

      {!isDrill && dueThisMonth > 0 && (
        <Link href="/planned" className="text-sm text-ink-muted hover:underline">
          Μένουν να πληρωθούν αυτόν τον μήνα <span className="font-medium tabular-nums text-ink">{money(dueThisMonth)}</span>
          {overdue > 0 && <span className="text-red-ink"> · {overdue} ληξιπρόθεσμα</span>} → Προγραμματισμένα
        </Link>
      )}

      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Όλες οι κινήσεις {isDrill ? "" : "της περιόδου"}</h2>
        <Link
          href={`/assistant?q=${encodeURIComponent(`Ανάλυσε τις κινήσεις (πληρωμένες) για ${periodLabel}. Τι ξεχωρίζει;`)}`}
          className="flex items-center gap-1.5 rounded-full border border-ai-border bg-ai-bg px-3 py-1 text-xs text-ai-ink hover:bg-ai-border/40"
        >
          <AiSpark />
          Ρώτα το Kansha AI →
        </Link>
      </div>
    </div>
  );

  return (
    <TransactionsTable
      transactions={rows}
      contacts={(contacts ?? []).map((c) => ({ id: c.id, label: c.name }))}
      projects={(projects ?? []).map((p) => ({ id: p.id, label: p.display_name }))}
      categories={(categories ?? []).map((c) => ({ id: c.id, label: c.name }))}
      accounts={(accounts ?? []).map((a) => ({ id: a.id, label: a.name }))}
      filters={summary}
    />
  );
}
