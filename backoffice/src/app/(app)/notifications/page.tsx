import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { formatMoney, formatDate } from "@/lib/format";
import { alertWindow, dueBefore, dueBetween, isoDay, isPayment } from "@/lib/alerts";

// Ειδοποιήσεις -- one page, read top to bottom, four blocks:
//   1. Θέλει απάντηση: what the books cannot settle alone (no project, no
//      invoice over 500 €, «προς επιβεβαίωση», late project phases)
//   2. Ληξιπρόθεσμα   3. Επόμενες 7 μέρες   4. Τι άλλαξε (last 7 days)
// Forecast rows ([ΠΡΟΒΛΕΨΗ], also on a not-yet-activated plan) and loan-funded
// rows are not payments yet, so they are left out of 2 and 3. «Λείπει
// τιμολόγιο» skips what never has one: rents, tax settlements, property
// purchases, public fees, and instalments of a plan.

type Row = {
  id: string; tx_date: string; due_date: string | null; gross_amount: number; description: string | null;
  counterparty_name: string | null; notes: string | null; project_id: string | null;
  accounts: { name: string; kind: string } | { name: string; kind: string }[] | null;
  projects: { display_name: string } | { display_name: string }[] | null;
  categories?: { code: string } | { code: string }[] | null;
  plan_id?: string | null;
  plan?: { notes: string | null } | { notes: string | null }[] | null;
};
const one = <T,>(x: T | T[] | null): T | null => (Array.isArray(x) ? x[0] ?? null : x);
const NO_INVOICE_EXPECTED = new Set(["ΡΥΘΜΊΣΕΙΣ_ΑΝΤΊ_ΜΙΣΘΏΜΑΤΟΣ", "ΕΝΟΊΚΙΑ_AND_ΜΙΣΘΏΜΑΤΑ", "ΑΓΟΡΆ_ΑΚΙΝΉΤΟΥ", "ΦΌΡΟΙ_AND_ΡΥΘΜΊΣΕΙΣ", "ΕΝΦΙΑ"]);
const needsInvoice = (r: Row) =>
  !r.plan_id && !NO_INVOICE_EXPECTED.has(one(r.categories ?? null)?.code ?? "") && !/^Τέλη /.test(r.description ?? "");

function Block({ title, count, tone, children }: { title: string; count: number; tone: "red" | "amber" | "plain"; children: React.ReactNode }) {
  const badge = { red: "bg-red-ink text-white", amber: "bg-amber-ink text-white", plain: "bg-bg text-ink-muted" }[tone];
  return (
    <section className="rounded-lg border border-line bg-surface">
      <h2 className="flex items-center gap-2 border-b border-line px-4 py-3 text-sm font-semibold">
        {title}
        <span className={`rounded-full px-2 py-0.5 text-xs ${count ? badge : "bg-bg text-ink-faint"}`}>{count}</span>
      </h2>
      {count ? <ul className="divide-y divide-line">{children}</ul> : <p className="px-4 py-3 text-sm text-ink-faint">Τίποτα.</p>}
    </section>
  );
}

function Line({ left, middle, right, href, sub }: { left: string; middle: string; right?: string; href?: string; sub?: string }) {
  const body = (
    <div className="flex flex-wrap items-baseline gap-x-4 gap-y-0.5 px-4 py-2.5 text-sm hover:bg-bg/60">
      <span className="w-20 shrink-0 text-xs tabular-nums text-ink-muted">{left}</span>
      <span className="min-w-0 flex-1">
        {middle}
        {sub && <span className="block text-xs text-ink-muted">{sub}</span>}
      </span>
      {right && <span className="tabular-nums">{right}</span>}
    </div>
  );
  return <li>{href ? <Link href={href}>{body}</Link> : body}</li>;
}

export default async function NotificationsPage() {
  const supabase = await createClient();
  const { today, week } = alertWindow();
  const since = isoDay(new Date(Date.now() - 60 * 86400000));
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
  const cols = "id, tx_date, due_date, gross_amount, description, counterparty_name, notes, project_id, plan_id, accounts(name, kind), projects(display_name), categories(code), plan:installment_plans!transactions_plan_id_fkey(notes)";
  const open = () => supabase.from("transactions").select(cols).in("status", ["pending", "scheduled"]).eq("direction", "expense");

  const [{ data: overdue }, { data: soon }, { data: noProject }, { data: noInvoice }, { data: toConfirm }, { data: phases }, { data: activity }] = await Promise.all([
    open().or(dueBefore(today)).order("tx_date"),
    open().or(dueBetween(today, week)).order("tx_date"),
    supabase.from("transactions").select(cols).eq("scope", "business").is("project_id", null).neq("status", "cancelled").gte("tx_date", since).order("tx_date", { ascending: false }),
    supabase.from("transactions").select(cols).eq("scope", "business").eq("status", "paid").eq("direction", "expense").eq("has_invoice", false).gte("gross_amount", 500).gte("tx_date", since).order("tx_date", { ascending: false }),
    open().ilike("notes", "%προς επιβεβαίωση%").order("tx_date"),
    supabase.from("project_phases").select("id, name, planned_end, project_id, projects(display_name)").neq("status", "done").lt("planned_end", today).order("planned_end"),
    supabase.from("activity_log").select("at, actor_email, via, action, entity, label").gte("at", weekAgo).order("at", { ascending: false }).limit(30),
  ]);

  const pay = (rows: Row[] | null) => (rows ?? []).filter(isPayment);
  const overdueRows = pay(overdue as Row[] | null);
  const soonRows = pay(soon as Row[] | null);
  const questions = [
    ...(phases ?? []).map((p) => ({ key: `ph${p.id}`, left: formatDate(p.planned_end), middle: `Καθυστερεί: ${p.name}`, sub: `${one(p.projects)?.display_name ?? ""} · άλλαξε ημερομηνία ή σημείωσέ τη ολοκληρωμένη`, href: `/projects/${p.project_id}` })),
    ...((noProject ?? []) as Row[]).map((r) => ({ key: `np${r.id}`, left: formatDate(r.tx_date), middle: `Σε ποιο έργο; ${r.description ?? r.counterparty_name ?? ""}`, sub: formatMoney(Number(r.gross_amount)), href: "/transactions" })),
    ...((noInvoice ?? []) as Row[]).filter(needsInvoice).map((r) => ({ key: `ni${r.id}`, left: formatDate(r.tx_date), middle: `Λείπει τιμολόγιο: ${r.description ?? r.counterparty_name ?? ""}`, sub: `${formatMoney(Number(r.gross_amount))} · ${one(r.projects)?.display_name ?? ""}`, href: r.project_id ? `/projects/${r.project_id}` : "/transactions" })),
    ...((toConfirm ?? []) as Row[]).map((r) => ({ key: `tc${r.id}`, left: formatDate(r.due_date ?? r.tx_date), middle: `Προς επιβεβαίωση: ${r.description ?? ""}`, sub: formatMoney(Number(r.gross_amount)), href: "/planned" })),
  ];

  const payLine = (r: Row) => {
    const acc = one(r.accounts);
    return (
      <Line key={r.id} left={formatDate(r.due_date ?? r.tx_date)} middle={r.description ?? r.counterparty_name ?? "Πληρωμή"}
        sub={[one(r.projects)?.display_name, acc ? (acc.kind === "cash" ? "μετρητά" : acc.name) : null].filter(Boolean).join(" · ")}
        right={formatMoney(Number(r.gross_amount))} href="/planned" />
    );
  };
  const total = (rows: Row[]) => rows.reduce((s, r) => s + Number(r.gross_amount), 0);

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold">Ειδοποιήσεις</h1>
        <p className="text-sm text-ink-muted">Τι θέλει την προσοχή σου σήμερα. Οι προβλέψεις δεν μετράνε εδώ — μόνο ό,τι είναι για πληρωμή.</p>
      </div>

      <Block title="Θέλει απάντηση από σένα" count={questions.length} tone="amber">
        {questions.map((q) => <Line key={q.key} left={q.left} middle={q.middle} sub={q.sub} href={q.href} />)}
      </Block>

      <Block title={`Ληξιπρόθεσμα${overdueRows.length ? ` · ${formatMoney(total(overdueRows))}` : ""}`} count={overdueRows.length} tone="red">
        {overdueRows.map(payLine)}
      </Block>

      <Block title={`Επόμενες 7 μέρες${soonRows.length ? ` · ${formatMoney(total(soonRows))}` : ""}`} count={soonRows.length} tone="amber">
        {soonRows.map(payLine)}
      </Block>

      <Block title="Τι άλλαξε την τελευταία εβδομάδα" count={(activity ?? []).length} tone="plain">
        {(activity ?? []).map((a, i) => (
          <Line key={i} left={new Date(a.at).toLocaleDateString("el-GR", { day: "2-digit", month: "2-digit" })}
            middle={`${a.actor_email ? a.actor_email.split("@")[0] : "Σύστημα"}${a.via === "claude" ? " (μέσω Claude)" : ""}: ${a.action === "insert" ? "νέο" : a.action === "update" ? "αλλαγή" : "διαγραφή"} · ${(a.label ?? a.entity).slice(0, 70)}`} />
        ))}
      </Block>
      <p className="text-xs text-ink-faint">Πλήρες ιστορικό: <Link href="/activity" className="underline">Ιστορικό</Link></p>
    </div>
  );
}
