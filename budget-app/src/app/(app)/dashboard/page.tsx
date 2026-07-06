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

export const dynamic = "force-dynamic";

function StatCard({
  label,
  value,
  tone = "default",
  hint,
  href,
}: {
  label: string;
  value: number;
  tone?: "default" | "positive" | "negative" | "primary";
  hint?: string;
  href?: string;
}) {
  const toneClass = {
    default: "text-foreground",
    positive: "text-positive",
    negative: "text-negative",
    primary: "text-primary",
  }[tone];

  const inner = (
    <CardContent className="pt-5">
      <p className="flex items-center justify-between text-xs font-medium text-muted">
        {label}
        {href ? <ArrowUpRight size={14} className="text-muted/70" /> : null}
      </p>
      <p className={`mt-1 text-2xl font-bold ${toneClass}`}>
        {formatEuro(value)}
      </p>
      {hint ? <p className="mt-1 text-[11px] text-muted">{hint}</p> : null}
    </CardContent>
  );

  if (href) {
    return (
      <Card className="transition hover:border-primary/40 hover:shadow-md">
        <Link href={href} className="block">
          {inner}
        </Link>
      </Card>
    );
  }
  return <Card>{inner}</Card>;
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

  // ── Per-contact payables / receivables (top 6) ─────────────────────────
  const contactName = (id: string | null) =>
    contacts.find((c) => c.id === id)?.name ?? "Χωρίς επαφή";
  const payByContact = new Map<string, number>();
  for (const t of expenses) {
    if (t.status !== "upcoming") continue;
    const k = contactName(t.contact_id);
    payByContact.set(k, (payByContact.get(k) ?? 0) + num(t.amount));
  }
  const topPayables = [...payByContact.entries()]
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 6);

  const recvByContact = new Map<string, number>();
  for (const t of income) {
    if (t.status !== "upcoming") continue;
    const k = contactName(t.contact_id);
    recvByContact.set(k, (recvByContact.get(k) ?? 0) + num(t.amount));
  }
  const topReceivables = [...recvByContact.entries()]
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 6);

  // ── Per-project / per-category charts ──────────────────────────────────
  const projectName = (id: string | null) =>
    projects.find((p) => p.id === id)?.name ?? "Χωρίς έργο";
  const byProjectMap = new Map<string, number>();
  for (const t of expenses) {
    if (t.status === "planned") continue;
    const key = projectName(t.project_id);
    byProjectMap.set(key, (byProjectMap.get(key) ?? 0) + num(t.amount));
  }
  const byProject = [...byProjectMap.entries()]
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value);

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
          href="/accounts"
        />
        <StatCard
          label="Επερχόμενες υποχρεώσεις"
          value={totalUpcoming}
          tone="negative"
          hint="Απλήρωτα έξοδα"
          href="/transactions?type=expense&status=upcoming"
        />
        <StatCard
          label="Ρευστότητα τώρα"
          value={liquidityNow}
          tone={liquidityNow >= 0 ? "positive" : "negative"}
          hint="Διαθέσιμα − Επερχόμενες υποχρεώσεις"
        />
        <StatCard
          label="Εισπρακτέα"
          value={totalReceivable}
          tone="positive"
          hint="Έσοδα που περιμένουμε"
          href="/transactions?type=income&status=upcoming"
        />
        <StatCard
          label="Αναμενόμενα κεφάλαια"
          value={totalIncoming + earmarkedFunding}
          hint="Γενικά + δεσμευμένη χρηματοδότηση"
          href="/income"
        />
        <StatCard
          label="Ρευστότητα με όλα τα αναμενόμενα"
          value={liquidityWithIncoming}
          tone={liquidityWithIncoming >= 0 ? "positive" : "negative"}
          hint="Διαθέσιμα + Αναμενόμενα + Χρηματοδότηση − Υποχρεώσεις"
        />
      </div>

      {/* ── 2+3. Πληρωτέα / Εισπρακτέα ανά επαφή ── */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>🔴 Τι χρωστάμε — ανά επαφή</CardTitle>
          </CardHeader>
          <CardContent>
            {topPayables.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted">
                Καμία εκκρεμής υποχρέωση.
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {topPayables.map((p) => (
                  <li
                    key={p.name}
                    className="flex items-center justify-between py-2 text-sm"
                  >
                    <span>{p.name}</span>
                    <span className="font-semibold text-negative">
                      {formatEuro(p.value)}
                    </span>
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

        <Card>
          <CardHeader>
            <CardTitle>🟢 Τι περιμένουμε — ανά επαφή</CardTitle>
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
                  <li
                    key={p.name}
                    className="flex items-center justify-between py-2 text-sm"
                  >
                    <span>{p.name}</span>
                    <span className="font-semibold text-positive">
                      {formatEuro(p.value)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── 4. Θέση ΦΠΑ ── */}
      <Card>
        <CardHeader>
          <CardTitle>🧾 Θέση ΦΠΑ</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <p className="text-xs text-muted">Πληρωμένο ΦΠΑ</p>
              <p className="text-xl font-bold">{formatEuro(vatPaid)}</p>
            </div>
            <div>
              <p className="text-xs text-muted">Πιστωτικό ΦΠΑ (προς επιστροφή/συμψηφισμό)</p>
              <p className="text-xl font-bold text-positive">
                {formatEuro(vatCredit)}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted">Οφειλόμενο ΦΠΑ</p>
              <p className="text-xl font-bold text-negative">
                {formatEuro(vatPayable)}
              </p>
            </div>
          </div>
          {vatPaid + vatCredit + vatPayable === 0 && (
            <p className="mt-3 text-xs text-muted">
              Συμπλήρωσε το πεδίο «ΦΠΑ» και την «Κατάσταση ΦΠΑ» στις κινήσεις
              για να ενημερώνεται αυτή η ενότητα.
            </p>
          )}
        </CardContent>
      </Card>

      {/* ── 5. Σύνολα ανά έργο ── */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>📊 Έξοδα ανά έργο</CardTitle>
          </CardHeader>
          <CardContent>
            <BarChartCard data={byProject} />
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
