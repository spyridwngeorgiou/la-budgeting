import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui";
import { BarChartCard, PieChartCard, ChartLegend } from "@/components/Charts";
import { formatEuro } from "@/lib/utils";
import type {
  Account,
  Transaction,
  Project,
  Category,
  Contact,
} from "@/lib/types";
import { TransactionFormModal } from "../transactions/TransactionFormModal";
import { PayButton } from "@/components/PayButton";

export const dynamic = "force-dynamic";

function StatCard({
  label,
  value,
  tone = "default",
  hint,
  detail,
}: {
  label: string;
  value: number;
  tone?: "default" | "positive" | "negative" | "primary";
  hint?: string;
  detail?: string;
}) {
  const toneClass = {
    default: "text-foreground",
    positive: "text-positive",
    negative: "text-negative",
    primary: "text-primary",
  }[tone];

  return (
    <Card>
      <CardContent className="pt-5">
      <p className="text-xs font-medium text-muted">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${toneClass}`}>
        {formatEuro(value)}
      </p>
      {hint ? <p className="mt-1 text-[11px] text-muted">{hint}</p> : null}
      {detail ? <p className="mt-2 text-xs font-medium text-foreground/80">{detail}</p> : null}
      </CardContent>
    </Card>
  );
}

export default async function DashboardPage() {
  const supabase = await createClient();

  const [accountsRes, txRes, projectsRes, categoriesRes, contactsRes] =
    await Promise.all([
      supabase.from("accounts").select("*"),
      supabase.from("transactions").select("*"),
      supabase.from("projects").select("*"),
      supabase.from("categories").select("*"),
      supabase.from("contacts").select("*").order("name"),
    ]);

  const accounts = (accountsRes.data ?? []) as Account[];
  const transactions = (txRes.data ?? []) as Transaction[];
  const projects = (projectsRes.data ?? []) as Project[];
  const categories = (categoriesRes.data ?? []) as Category[];
  const contacts = (contactsRes.data ?? []) as Contact[];

  const num = (n: number | string | null) => Number(n) || 0;

  // ── Funds ──────────────────────────────────────────────────────────────
  const totalAvailable = accounts
    .filter((a) => !a.is_incoming && !a.project_id)
    .reduce((s, a) => s + num(a.balance), 0);
  const totalIncoming = accounts
    .filter((a) => a.is_incoming && !a.project_id)
    .reduce((s, a) => s + num(a.balance), 0);
  const earmarkedFunding = accounts
    .filter((a) => a.project_id)
    .reduce((s, a) => s + num(a.balance), 0);

  // ── Obligations / receivables ──────────────────────────────────────────
  const expenses = transactions.filter((t) => t.type === "expense");
  const income = transactions.filter((t) => t.type === "income");
  const totalUpcoming = expenses
    .filter((t) => t.status === "upcoming")
    .reduce((s, t) => s + num(t.amount), 0);
  const totalReceivable = income
    .filter((t) => t.status === "upcoming")
    .reduce((s, t) => s + num(t.amount), 0);
  const upcomingExpenseCount = expenses.filter(
    (t) => t.status === "upcoming",
  ).length;
  const upcomingIncomeCount = income.filter((t) => t.status === "upcoming").length;
  const coveragePct = totalUpcoming > 0 ? (totalAvailable / totalUpcoming) * 100 : 100;
  const liquidityGap = Math.max(0, totalUpcoming - totalAvailable);

  const liquidityNow = totalAvailable - totalUpcoming;
  const liquidityWithIncoming =
    totalAvailable + totalIncoming + earmarkedFunding - totalUpcoming;

  // ── VAT position ───────────────────────────────────────────────────────
  const vatPaid = transactions
    .filter((t) => t.vat_status === "paid")
    .reduce((s, t) => s + num(t.vat_amount), 0);
  const vatCredit = transactions
    .filter((t) => t.vat_status === "credit")
    .reduce((s, t) => s + num(t.vat_amount), 0);
  const vatPayable = transactions
    .filter((t) => t.vat_status === "payable")
    .reduce((s, t) => s + num(t.vat_amount), 0);

  // ── Books vs real picture ─────────────────────────────────────────
  const committedExpenses = expenses.filter((t) => t.status !== "planned");
  const invoicedTotal = committedExpenses
    .filter((t) => t.has_invoice)
    .reduce((s, t) => s + num(t.amount), 0);
  const cashInformalTotal = committedExpenses
    .filter((t) => !t.has_invoice)
    .reduce((s, t) => s + num(t.amount), 0);

  // ── Next payments (top upcoming by amount) ──────────────────────────
  const nextPayments = expenses
    .filter((t) => t.status === "upcoming")
    .sort((a, b) => num(b.amount) - num(a.amount))
    .slice(0, 5);

  // ── Per-contact payables / receivables (top 6) ─────────────────────────
  const contactName = (id: string | null) =>
    contacts.find((c) => c.id === id)?.name ?? "Χωρίς επαφή";
  const payByContact = new Map<string, { id: string | null; value: number }>();
  for (const t of expenses) {
    if (t.status !== "upcoming") continue;
    const k = contactName(t.contact_id);
    const cur = payByContact.get(k) ?? { id: t.contact_id, value: 0 };
    cur.value += num(t.amount);
    payByContact.set(k, cur);
  }
  const topPayables = [...payByContact.entries()]
    .map(([name, v]) => ({ name, id: v.id, value: v.value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 6);

  const recvByContact = new Map<string, { id: string | null; value: number }>();
  for (const t of income) {
    if (t.status !== "upcoming") continue;
    const k = contactName(t.contact_id);
    const cur = recvByContact.get(k) ?? { id: t.contact_id, value: 0 };
    cur.value += num(t.amount);
    recvByContact.set(k, cur);
  }
  const topReceivables = [...recvByContact.entries()]
    .map(([name, v]) => ({ name, id: v.id, value: v.value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 6);

  // ── Per-project / per-category charts ──────────────────────────────────
  const projectName = (id: string | null) =>
    projects.find((p) => p.id === id)?.name ?? "Χωρίς έργο";
  const byProjectMap = new Map<string, { id: string | null; value: number }>();
  for (const t of expenses) {
    if (t.status === "planned") continue;
    const key = projectName(t.project_id);
    const cur = byProjectMap.get(key) ?? { id: t.project_id, value: 0 };
    cur.value += num(t.amount);
    byProjectMap.set(key, cur);
  }
  const byProjectFull = [...byProjectMap.entries()]
    .map(([name, v]) => ({ name, id: v.id, value: v.value }))
    .sort((a, b) => b.value - a.value);
  const byProject = byProjectFull.map(({ name, value }) => ({ name, value }));

  const categoryName = (id: string | null) =>
    categories.find((c) => c.id === id)?.name ?? "Χωρίς κατηγορία";
  const byCatMap = new Map<string, number>();
  for (const t of expenses) {
    if (t.status === "planned") continue;
    const key = categoryName(t.category_id);
    byCatMap.set(key, (byCatMap.get(key) ?? 0) + num(t.amount));
  }
  const byCategory = [...byCatMap.entries()]
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-primary">Κέντρο Ελέγχου</h1>
          <p className="text-sm text-muted">
            Ρευστότητα, υποχρεώσεις, απαιτήσεις & ΦΠΑ με μια ματιά
          </p>
        </div>
        <TransactionFormModal
          projects={projects}
          accounts={accounts}
          categories={categories}
          contacts={contacts}
        />
      </div>

      {/* ── 1. Κατάσταση ρευστότητας ── */}
      {liquidityNow >= 0 ? (
        <div className="rounded-xl border border-green-200 bg-green-50 p-4">
          <p className="text-sm font-semibold text-green-800">
            ✅ Επαρκής ρευστότητα
          </p>
          <p className="mt-1 text-sm text-green-700">
            Τα διαθέσιμα καλύπτουν τις επερχόμενες υποχρεώσεις — πλεόνασμα{" "}
            <strong>{formatEuro(liquidityNow)}</strong>.
          </p>
        </div>
      ) : liquidityWithIncoming >= 0 ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
          <p className="text-sm font-semibold text-amber-800">
            ⚠️ Έλλειμμα ρευστότητας τώρα: {formatEuro(Math.abs(liquidityNow))}
          </p>
          <p className="mt-1 text-sm text-amber-700">
            Καλύπτεται <strong>μόνο εφόσον εισπραχθούν</strong> τα αναμενόμενα
            και η χρηματοδότηση (τότε πλεόνασμα{" "}
            {formatEuro(liquidityWithIncoming)}).
          </p>
        </div>
      ) : (
        <div className="rounded-xl border border-red-300 bg-red-50 p-4">
          <p className="text-sm font-semibold text-red-800">
            🛑 Σοβαρό πρόβλημα ρευστότητας: έλλειμμα{" "}
            {formatEuro(Math.abs(liquidityWithIncoming))}
          </p>
          <p className="mt-1 text-sm text-red-700">
            Δεν καλύπτεται ούτε με όλα τα αναμενόμενα. Απαιτείται ενέργεια.
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard
          label="Διαθέσιμα κεφάλαια"
          value={totalAvailable}
          tone="primary"
          hint="Άθροισμα διαθέσιμων λογαριασμών"
          detail={`${accounts.filter((a) => !a.is_incoming && !a.project_id).length} ενεργοί λογαριασμοί`}
        />
        <StatCard
          label="Επερχόμενες υποχρεώσεις"
          value={totalUpcoming}
          tone="negative"
          hint="Απλήρωτα έξοδα"
          detail={`${upcomingExpenseCount} κινήσεις σε εκκρεμότητα`}
        />
        <StatCard
          label="Ρευστότητα τώρα"
          value={liquidityNow}
          tone={liquidityNow >= 0 ? "positive" : "negative"}
          hint="Διαθέσιμα − Επερχόμενες υποχρεώσεις"
          detail={
            liquidityNow >= 0
              ? `Κάλυψη υποχρεώσεων ${Math.round(coveragePct)}%`
              : `Έλλειμμα κάλυψης ${formatEuro(liquidityGap)}`
          }
        />
        <StatCard
          label="Εισπρακτέα"
          value={totalReceivable}
          tone="positive"
          hint="Έσοδα που περιμένουμε"
          detail={`${upcomingIncomeCount} κινήσεις σε αναμονή`}
        />
        <StatCard
          label="Αναμενόμενα κεφάλαια"
          value={totalIncoming + earmarkedFunding}
          hint="Γενικά + δεσμευμένη χρηματοδότηση"
          detail={`Γενικά ${formatEuro(totalIncoming)} + Δεσμευμένα ${formatEuro(earmarkedFunding)}`}
        />
        <StatCard
          label="Ρευστότητα με όλα τα αναμενόμενα"
          value={liquidityWithIncoming}
          tone={liquidityWithIncoming >= 0 ? "positive" : "negative"}
          hint="Διαθέσιμα + Αναμενόμενα + Χρηματοδότηση − Υποχρεώσεις"
          detail={
            liquidityWithIncoming >= 0
              ? `Buffer ${formatEuro(liquidityWithIncoming)}`
              : `Υπόλοιπο ελλείμματος ${formatEuro(Math.abs(liquidityWithIncoming))}`
          }
        />
      </div>

      {/* ── Επόμενες πληρωμές — one-tap ενέργεια ── */}
      {nextPayments.length > 0 && (
        <Card className="border-l-4 border-l-primary">
          <CardHeader className="flex items-center justify-between">
            <CardTitle>Επόμενες πληρωμές</CardTitle>
            <Link
              href="/transactions?type=expense&status=upcoming"
              className="text-xs text-primary hover:underline"
            >
              Όλες →
            </Link>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-border">
              {nextPayments.map((t) => (
                <li
                  key={t.id}
                  className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium">{t.notes || "—"}</p>
                    <p className="text-xs text-muted">
                      {contactName(t.contact_id)} · {projectName(t.project_id)}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="font-semibold">
                      {formatEuro(num(t.amount))}
                    </span>
                    <PayButton id={t.id} />
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* ── Λογιστική vs πραγματική εικόνα ── */}
      <Card>
        <CardHeader>
          <CardTitle>Λογιστική εικόνα (δεσμευμένα έξοδα)</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Link
              href="/transactions?type=expense&invoice=1"
              className="rounded-lg border border-border p-3 transition hover:border-primary/40 hover:shadow-sm"
            >
              <p className="flex items-center justify-between text-xs text-muted">
                Με παραστατικό (τιμολόγια, ΦΠΑ) <ArrowUpRight size={12} />
              </p>
              <p className="text-xl font-bold text-primary">
                {formatEuro(invoicedTotal)}
              </p>
            </Link>
            <Link
              href="/transactions?type=expense&invoice=0"
              className="rounded-lg border border-border p-3 transition hover:border-primary/40 hover:shadow-sm"
            >
              <p className="flex items-center justify-between text-xs text-muted">
                Χωρίς παραστατικό (συνήθως μετρητά) <ArrowUpRight size={12} />
              </p>
              <p className="text-xl font-bold">
                {formatEuro(cashInformalTotal)}
              </p>
            </Link>
          </div>
          <p className="mt-2 text-[11px] text-muted">
            Στις κινήσεις, σήμανε «Με παραστατικό» όσες έχουν τιμολόγιο ώστε
            αυτή η εικόνα να αντιστοιχεί στα βιβλία.
          </p>
        </CardContent>
      </Card>

      {/* ── 2+3. Πληρωτέα / Εισπρακτέα ανά επαφή ── */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="border-l-4 border-l-negative">
          <CardHeader className="flex items-center justify-between">
            <CardTitle>Τι χρωστάμε — ανά επαφή</CardTitle>
            <span className="text-sm font-bold text-negative">
              {formatEuro(topPayables.reduce((s, p) => s + p.value, 0))}
            </span>
          </CardHeader>
          <CardContent>
            {topPayables.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted">
                Καμία εκκρεμής υποχρέωση.
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {topPayables.map((p) => (
                  <li key={p.name}>
                    {p.id ? (
                      <Link
                        href={`/contacts/${p.id}`}
                        className="flex items-center justify-between py-2 text-sm transition hover:bg-slate-50"
                      >
                        <span className="flex items-center gap-1 text-foreground hover:text-primary">
                          {p.name}
                          <ArrowUpRight size={12} className="text-muted/60" />
                        </span>
                        <span className="font-semibold text-negative">
                          {formatEuro(p.value)}
                        </span>
                      </Link>
                    ) : (
                      <Link
                        href="/transactions?type=expense&status=upcoming"
                        className="flex items-center justify-between py-2 text-sm transition hover:bg-slate-50"
                      >
                        <span className="text-muted">{p.name}</span>
                        <span className="font-semibold text-negative">
                          {formatEuro(p.value)}
                        </span>
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            )}
            <Link
              href="/contacts"
              className="mt-3 inline-block text-xs text-primary hover:underline"
            >
              Όλες οι επαφές →
            </Link>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-positive">
          <CardHeader className="flex items-center justify-between">
            <CardTitle>Τι περιμένουμε — ανά επαφή</CardTitle>
            <span className="text-sm font-bold text-positive">
              {formatEuro(topReceivables.reduce((s, p) => s + p.value, 0))}
            </span>
          </CardHeader>
          <CardContent>
            {topReceivables.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted">
                Δεν υπάρχουν καταχωρημένα εισπρακτέα. Πρόσθεσε κίνηση τύπου
                «Έσοδο» με κατάσταση «Επερχόμενο».
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {topReceivables.map((p) => (
                  <li key={p.name}>
                    <Link
                      href={p.id ? `/contacts/${p.id}` : "/transactions?type=income&status=upcoming"}
                      className="flex items-center justify-between py-2 text-sm transition hover:bg-slate-50"
                    >
                      <span className="flex items-center gap-1 text-foreground hover:text-primary">
                        {p.name}
                        <ArrowUpRight size={12} className="text-muted/60" />
                      </span>
                      <span className="font-semibold text-positive">
                        {formatEuro(p.value)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── 4. Θέση ΦΠΑ ── */}
      <Card className="border-l-4 border-l-accent">
        <CardHeader>
          <CardTitle>Θέση ΦΠΑ</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Link
              href="/transactions?vat=paid"
              className="rounded-lg border border-border p-3 transition hover:border-primary/40 hover:shadow-sm"
            >
              <p className="flex items-center justify-between text-xs text-muted">
                Πληρωμένο ΦΠΑ <ArrowUpRight size={12} />
              </p>
              <p className="text-xl font-bold">{formatEuro(vatPaid)}</p>
            </Link>
            <Link
              href="/transactions?vat=credit"
              className="rounded-lg border border-border p-3 transition hover:border-primary/40 hover:shadow-sm"
            >
              <p className="flex items-center justify-between text-xs text-muted">
                Πιστωτικό ΦΠΑ <ArrowUpRight size={12} />
              </p>
              <p className="text-xl font-bold text-positive">
                {formatEuro(vatCredit)}
              </p>
            </Link>
            <Link
              href="/transactions?vat=payable"
              className="rounded-lg border border-border p-3 transition hover:border-primary/40 hover:shadow-sm"
            >
              <p className="flex items-center justify-between text-xs text-muted">
                Οφειλόμενο ΦΠΑ <ArrowUpRight size={12} />
              </p>
              <p className="text-xl font-bold text-negative">
                {formatEuro(vatPayable)}
              </p>
            </Link>
          </div>
          {vatPaid + vatCredit + vatPayable === 0 && (
            <p className="mt-3 text-xs text-muted">
              Συμπλήρωσε το ποσοστό ΦΠΑ και την «Κατάσταση ΦΠΑ» στις
              κινήσεις για να ενημερώνεται αυτή η ενότητα.
            </p>
          )}
        </CardContent>
      </Card>

      {/* ── 5. Σύνολα ανά έργο ── */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Έξοδα ανά έργο</CardTitle>
          </CardHeader>
          <CardContent>
            <BarChartCard data={byProject} />
            <ul className="mt-2 divide-y divide-border">
              {byProjectFull.map((p) => (
                <li key={p.name}>
                  <Link
                    href={p.id ? `/projects/${p.id}` : "/transactions"}
                    className="flex items-center justify-between py-1.5 text-sm transition hover:bg-slate-50"
                  >
                    <span className="flex items-center gap-1 hover:text-primary">
                      {p.name} <ArrowUpRight size={12} className="text-muted/60" />
                    </span>
                    <span className="font-medium">{formatEuro(p.value)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Έξοδα ανά κατηγορία</CardTitle>
          </CardHeader>
          <CardContent>
            <PieChartCard data={byCategory} />
            <ChartLegend data={byCategory} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
