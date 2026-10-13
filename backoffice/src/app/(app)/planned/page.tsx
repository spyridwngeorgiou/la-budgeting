import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

// Προγραμματισμένα -- everything that has NOT happened yet: open payments
// (pending / scheduled), repeating instalments, and money we expect to come
// in. The counterpart of Κινήσεις, which shows only what has happened. When
// something here is paid it becomes status 'paid' and moves to Κινήσεις.
//
// Read top to bottom: overdue -> rest of this month -> next months (closed,
// open on click) -> repeating (one line per plan) -> money expected.

const HORIZON_MONTHS = 12;
const eur = new Intl.NumberFormat("el-GR", { maximumFractionDigits: 0 });
const money = (n: number) => `${eur.format(Math.round(n))} €`;
const addMonths = (m: string, n: number) => {
  const [y, mo] = m.split("-").map(Number);
  return new Date(Date.UTC(y, mo - 1 + n, 1)).toISOString().slice(0, 7);
};
const monthName = (m: string) =>
  new Date(`${m}-01T00:00:00Z`).toLocaleDateString("el-GR", { month: "long", year: "numeric", timeZone: "UTC" });
const day = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("el-GR", { day: "2-digit", month: "2-digit", timeZone: "UTC" });

type Item = {
  id: string;
  date: string;
  label: string;
  amount: number;
  project: string | null;
  account: string | null;
  tag: string | null;
};

function ItemList({ items }: { items: Item[] }) {
  return (
    <ul className="divide-y divide-line text-sm">
      {items.map((i) => (
        <li key={i.id} className="grid grid-cols-[3.5rem_1fr_auto] items-baseline gap-3 py-2">
          <span className="tabular-nums text-ink-faint">{day(i.date)}</span>
          <span className="min-w-0">
            <span className="block truncate">{i.label}</span>
            <span className="text-xs text-ink-faint">
              {[i.project, i.account].filter(Boolean).join(" · ")}
              {i.tag && <span className="ml-2 rounded bg-bg px-1.5 py-0.5 text-[11px] text-ink-muted">{i.tag}</span>}
            </span>
          </span>
          <span className="tabular-nums">{money(i.amount)}</span>
        </li>
      ))}
    </ul>
  );
}

function Section({ title, total, tone, children, open }: { title: string; total?: number; tone?: "red"; children: React.ReactNode; open?: boolean }) {
  return (
    <details open={open} className={`rounded-lg border bg-surface px-5 py-3 ${tone === "red" ? "border-red-ink/30" : "border-line"}`}>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 py-1">
        <span className={`text-sm font-semibold ${tone === "red" ? "text-red-ink" : ""}`}>{title}</span>
        {total != null && <span className={`tabular-nums font-semibold ${tone === "red" ? "text-red-ink" : ""}`}>{money(total)}</span>}
      </summary>
      <div className="pt-2">{children}</div>
    </details>
  );
}

export default async function PlannedPage() {
  const supabase = await createClient();
  const today = new Date().toISOString().slice(0, 10);
  const thisMonth = today.slice(0, 7);
  const horizonEnd = `${addMonths(thisMonth, HORIZON_MONTHS)}-01`;

  const [{ data: open }, { data: plans }, { data: expected }, { data: paidThisMonth }] = await Promise.all([
    supabase
      .from("transactions")
      .select("id, tx_date, due_date, direction, gross_amount, description, notes, plan_id, installment_no, projects(display_name, code), accounts(name)")
      .in("status", ["pending", "scheduled"])
      .lt("tx_date", horizonEnd)
      .order("tx_date")
      .limit(5000),
    supabase.from("installment_plans").select("id, label, installment_count, amount_per_installment, vat_per_installment, withholding_per_installment, status, accounts(name), projects(display_name)").eq("status", "active"),
    supabase.from("expected_income").select("id, source, amount, certainty, expected_month, creates_liability"),
    supabase.from("transactions").select("gross_amount").eq("status", "paid").eq("direction", "expense").gte("tx_date", `${thisMonth}-01`).lte("tx_date", today),
  ]);

  const one = <T,>(x: T | T[] | null | undefined) => (Array.isArray(x) ? x[0] : x) ?? null;
  const tagOf = (t: { notes: string | null; description: string | null; projects: unknown }) => {
    if ((t.notes ?? "").startsWith("[ΠΡΟΒΛΕΨΗ]")) return "εκτίμηση";
    const p = one(t.projects as { code: string } | { code: string }[] | null);
    if (p?.code === "Q003_LAZARAKI32_GLYFADA" && /^Κατασκευή/.test(t.description ?? "")) return "με το δάνειο";
    return null;
  };
  const toItem = (t: NonNullable<typeof open>[number]): Item => ({
    id: t.id,
    date: t.due_date ?? t.tx_date,
    label: t.description ?? "Κίνηση",
    amount: Number(t.gross_amount ?? 0),
    project: one(t.projects)?.display_name ?? null,
    account: one(t.accounts)?.name ?? null,
    tag: tagOf(t),
  });

  const payments = (open ?? []).filter((t) => t.direction === "expense");
  const oneOff = payments.filter((t) => !t.plan_id).map(toItem);
  const instalments = payments.filter((t) => t.plan_id).map((t) => ({ ...toItem(t), planId: t.plan_id! }));
  const sum = (xs: { amount: number }[]) => xs.reduce((s, x) => s + x.amount, 0);

  // Overdue = anything open whose due date has passed (one-off or instalment).
  const overdue = [...oneOff, ...instalments].filter((i) => i.date < today).sort((a, b) => a.date.localeCompare(b.date));
  const restOfMonth = oneOff.filter((i) => i.date >= today && i.date.slice(0, 7) === thisMonth);
  const restOfMonthInst = instalments.filter((i) => i.date >= today && i.date.slice(0, 7) === thisMonth);
  const later = Array.from({ length: HORIZON_MONTHS }, (_, k) => addMonths(thisMonth, k + 1)).map((m) => ({
    month: m,
    items: oneOff.filter((i) => i.date.slice(0, 7) === m),
    repeating: sum(instalments.filter((i) => i.date.slice(0, 7) === m)),
  }));

  // Repeating: one line per active plan, with its next open instalment.
  const next = new Map<string, (typeof instalments)[number]>();
  const left = new Map<string, number>();
  for (const i of instalments.sort((a, b) => a.date.localeCompare(b.date))) {
    if (!next.has(i.planId)) next.set(i.planId, i);
    left.set(i.planId, (left.get(i.planId) ?? 0) + 1);
  }
  const repeating = (plans ?? [])
    .filter((p) => next.has(p.id))
    .map((p) => ({
      id: p.id,
      label: p.label,
      monthly: Number(p.amount_per_installment) + Number(p.vat_per_installment ?? 0) - Number(p.withholding_per_installment ?? 0),
      next: next.get(p.id)!.date,
      left: left.get(p.id) ?? 0,
      total: p.installment_count,
      where: [one(p.projects)?.display_name, one(p.accounts)?.name].filter(Boolean).join(" · "),
    }))
    .sort((a, b) => a.next.localeCompare(b.next));

  // Money we expect: open receipts plus expected income.
  const incoming = [
    ...(open ?? []).filter((t) => t.direction === "income").map((t) => ({ ...toItem(t), tag: "βέβαιο" as string | null })),
    ...(expected ?? []).map((e) => ({
      id: e.id,
      date: `${String(e.expected_month ?? thisMonth).slice(0, 7)}-01`,
      label: e.source,
      amount: Number(e.amount),
      project: null,
      account: "Μετρητά",
      tag: [e.certainty === "certain" ? "βέβαιο" : "αβέβαιο", e.creates_liability ? "δάνειο" : ""].filter(Boolean).join(" · "),
    })),
  ].sort((a, b) => a.date.localeCompare(b.date));

  const paidSoFar = (paidThisMonth ?? []).reduce((s, t) => s + Number(t.gross_amount ?? 0), 0);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold">Προγραμματισμένα</h1>
        <p className="text-sm text-ink-muted">Ό,τι δεν έχει γίνει ακόμα. Μόλις πληρωθεί, πηγαίνει στις Κινήσεις.</p>
        <Link href="/transactions" className="mt-1 inline-block text-sm text-ink-muted hover:underline">
          Αυτόν τον μήνα πληρώσαμε ως τώρα <span className="font-medium tabular-nums text-ink">{money(paidSoFar)}</span> → Κινήσεις
        </Link>
      </div>

      {overdue.length > 0 && (
        <Section title={`Ληξιπρόθεσμα · ${overdue.length}`} total={sum(overdue)} tone="red" open>
          <ItemList items={overdue} />
        </Section>
      )}

      <Section title={`Μέχρι τέλος ${monthName(thisMonth)}`} total={sum(restOfMonth) + sum(restOfMonthInst)} open>
        <ItemList items={restOfMonth} />
        {restOfMonthInst.length > 0 && (
          <div className="flex justify-between border-t border-line py-2 text-sm text-ink-muted">
            <span>+ επαναλαμβανόμενα του μήνα ({restOfMonthInst.length})</span>
            <span className="tabular-nums">{money(sum(restOfMonthInst))}</span>
          </div>
        )}
        {restOfMonth.length === 0 && restOfMonthInst.length === 0 && <p className="py-2 text-sm text-ink-faint">Τίποτα άλλο αυτόν τον μήνα.</p>}
      </Section>

      <section className="rounded-lg border border-line bg-surface px-5 py-3">
        <div className="py-1 text-sm font-semibold">Επόμενοι μήνες</div>
        {later.map((m) => {
          const total = sum(m.items) + m.repeating;
          if (!total) return null;
          return (
            <details key={m.month} className="border-t border-line first:border-t-0">
              <summary className="flex cursor-pointer list-none items-center justify-between py-2.5 text-sm hover:bg-bg/60">
                <span className="capitalize">{monthName(m.month)}</span>
                <span className="tabular-nums font-medium">{money(total)}</span>
              </summary>
              <ItemList items={m.items} />
              {m.repeating > 0 && (
                <div className="flex justify-between border-t border-line py-2 text-sm text-ink-muted">
                  <span>+ επαναλαμβανόμενα</span>
                  <span className="tabular-nums">{money(m.repeating)}</span>
                </div>
              )}
            </details>
          );
        })}
      </section>

      <Section title="Επαναλαμβανόμενα" total={sum(repeating.map((r) => ({ amount: r.monthly })))} >
        <ul className="divide-y divide-line text-sm">
          {repeating.map((r) => (
            <li key={r.id} className="grid grid-cols-[1fr_auto] items-baseline gap-3 py-2">
              <span className="min-w-0">
                <span className="block truncate">{r.label}</span>
                <span className="text-xs text-ink-faint">
                  {r.where} · επόμενη {day(r.next)} · απομένουν {r.left}{r.total ? ` από ${r.total}` : ""}
                </span>
              </span>
              <span className="tabular-nums">{money(r.monthly)}<span className="text-xs text-ink-faint">/μήνα</span></span>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Χρήματα που περιμένουμε" total={sum(incoming)}>
        <ItemList items={incoming} />
      </Section>
    </div>
  );
}
