import { createClient } from "@/lib/supabase/server";
import { Card, Badge, Select, Button, Input } from "@/components/ui";
import { DeleteButton } from "@/components/DeleteButton";
import { PayButton } from "@/components/PayButton";
import { formatEuro, formatDate } from "@/lib/utils";
import {
  TX_ACTIVE_STATUS_LABEL,
  TX_TYPE_LABEL,
  normalizeTxStatus,
  type Transaction,
  type Project,
  type Account,
  type Category,
  type Contact,
} from "@/lib/types";
import { TransactionFormModal } from "./TransactionFormModal";
import { deleteTransaction } from "./actions";

export const dynamic = "force-dynamic";

export default async function TransactionsPage({
  searchParams,
}: {
  searchParams: Promise<{
    project?: string;
    status?: string;
    type?: string;
    q?: string;
    vat?: string;
    invoice?: string;
  }>;
}) {
  const sp = await searchParams;
  const supabase = await createClient();

  const [txRes, projRes, accRes, catRes, conRes] = await Promise.all([
    supabase.from("transactions").select("*").order("tx_date", { ascending: false }),
    supabase.from("projects").select("*").order("name"),
    supabase.from("accounts").select("*").order("name"),
    supabase.from("categories").select("*").order("name"),
    supabase.from("contacts").select("*").order("name"),
  ]);

  let transactions = (txRes.data ?? []) as Transaction[];
  const projects = (projRes.data ?? []) as Project[];
  const accounts = (accRes.data ?? []) as Account[];
  const categories = (catRes.data ?? []) as Category[];
  const contacts = (conRes.data ?? []) as Contact[];

  const projNameFor = (id: string | null) =>
    projects.find((p) => p.id === id)?.name ?? "";
  const contactNameFor = (id: string | null) =>
    contacts.find((c) => c.id === id)?.name ?? "";

  const statusFilter = sp.status === "planned" ? "upcoming" : sp.status;
  if (sp.project) transactions = transactions.filter((t) => t.project_id === sp.project);
  if (statusFilter) transactions = transactions.filter((t) => normalizeTxStatus(t.status) === statusFilter);
  if (sp.type) transactions = transactions.filter((t) => t.type === sp.type);
  if (sp.vat) transactions = transactions.filter((t) => t.vat_status === sp.vat);
  if (sp.invoice === "1") transactions = transactions.filter((t) => t.has_invoice);
  if (sp.invoice === "0") transactions = transactions.filter((t) => !t.has_invoice);
  if (sp.q) {
    const q = sp.q.toLowerCase();
    transactions = transactions.filter((t) =>
      [t.notes, t.source, projNameFor(t.project_id), contactNameFor(t.contact_id)]
        .filter(Boolean)
        .some((s) => String(s).toLowerCase().includes(q)),
    );
  }

  const num = (n: number | string) => Number(n) || 0;
  const projName = (id: string | null) =>
    projects.find((p) => p.id === id)?.name ?? "—";

  const expenseRows = transactions.filter((t) => t.type === "expense");
  const incomeRows = transactions.filter((t) => t.type === "income");
  const expenseTotal = expenseRows.reduce((s, t) => s + num(t.amount), 0);
  const incomeTotal = incomeRows.reduce((s, t) => s + num(t.amount), 0);
  const netBalance = incomeTotal - expenseTotal;

  const currentParams = {
    project: sp.project ?? "",
    status: sp.status ?? "",
    type: sp.type ?? "",
    q: sp.q ?? "",
    vat: sp.vat ?? "",
    invoice: sp.invoice ?? "",
  };

  const hasActiveFilters = Object.values(currentParams).some(Boolean);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-primary">Κινήσεις</h1>
          <p className="text-sm text-muted">Έξοδα και έσοδα όλων των έργων</p>
        </div>
        <TransactionFormModal
          projects={projects}
          accounts={accounts}
          categories={categories}
          contacts={contacts}
        />
      </div>

      {/* Sticky filters */}
      <div className="sticky top-2 z-20 -mx-2 rounded-xl border border-border bg-background/95 p-2 backdrop-blur supports-[backdrop-filter]:bg-background/80 sm:-mx-0 sm:p-3">
        <form className="grid grid-cols-2 items-end gap-3 sm:flex sm:flex-wrap">
          <div className="col-span-2 sm:w-56">
            <label className="mb-1 block text-xs font-medium text-muted">Αναζήτηση</label>
            <Input
              name="q"
              defaultValue={sp.q ?? ""}
              placeholder="περιγραφή, πηγή, έργο…"
            />
          </div>
          <div className="col-span-2 sm:w-48">
            <label className="mb-1 block text-xs font-medium text-muted">Έργο</label>
            <Select name="project" defaultValue={sp.project ?? ""}>
              <option value="">Όλα τα έργα</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="sm:w-40">
            <label className="mb-1 block text-xs font-medium text-muted">Κατάσταση</label>
            <Select name="status" defaultValue={sp.status ?? ""}>
              <option value="">Όλες</option>
              {Object.entries(TX_ACTIVE_STATUS_LABEL).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </Select>
          </div>
          <div className="sm:w-36">
            <label className="mb-1 block text-xs font-medium text-muted">Τύπος</label>
            <Select name="type" defaultValue={sp.type ?? ""}>
              <option value="">Όλοι</option>
              <option value="expense">Έξοδο</option>
              <option value="income">Έσοδο</option>
            </Select>
          </div>
          <Button variant="secondary" type="submit" className="col-span-2 sm:col-span-1">
            Φιλτράρισμα
          </Button>
          {hasActiveFilters && (
            <a
              href="/transactions"
              className="col-span-2 inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-medium text-muted transition hover:bg-slate-100 sm:col-span-1"
            >
              Καθαρισμός
            </a>
          )}
        </form>
      </div>

      <Card className="border-l-4 border-l-primary">
        <div className="grid grid-cols-1 gap-3 p-4 md:grid-cols-3">
          <div>
            <p className="text-xs font-medium text-muted">Σύνολο εξόδων</p>
            <p className="mt-1 text-xl font-bold text-negative">{formatEuro(expenseTotal)}</p>
          </div>
          <div>
            <p className="text-xs font-medium text-muted">Σύνολο εσόδων</p>
            <p className="mt-1 text-xl font-bold text-positive">{formatEuro(incomeTotal)}</p>
          </div>
          <div>
            <p className="text-xs font-medium text-muted">Καθαρό αποτέλεσμα</p>
            <p className={`mt-1 text-xl font-bold ${netBalance >= 0 ? "text-primary" : "text-negative"}`}>
              {formatEuro(netBalance)}
            </p>
          </div>
        </div>
      </Card>

      {/* Κινητό: κάρτες */}
      <div className="space-y-3 md:hidden">
        {transactions.length === 0 ? (
          <Card className="p-6 text-center text-sm text-muted">
            Δεν υπάρχουν κινήσεις.
          </Card>
        ) : (
          transactions.map((t) => (
            <Card key={t.id} className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-medium">{t.notes || "Κίνηση"}</p>
                  <p className="text-xs text-muted">
                    {projName(t.project_id)} · {formatDate(t.tx_date)}
                  </p>
                </div>
                <span
                  className={`shrink-0 font-semibold ${
                    t.type === "income" ? "text-positive" : ""
                  }`}
                >
                  {t.type === "income" ? "+" : "−"}
                  {formatEuro(num(t.amount))}
                </span>
              </div>
              <div className="mt-3 flex items-center justify-between">
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                  <Badge tone={t.type}>{TX_TYPE_LABEL[t.type]}</Badge>
                  <span className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
                    {t.has_invoice ? "Με ΦΠΑ" : "Χωρίς ΦΠΑ"}
                  </span>
                  <Badge tone={normalizeTxStatus(t.status)}>{TX_ACTIVE_STATUS_LABEL[normalizeTxStatus(t.status)]}</Badge>
                  <span>{t.source || "—"}</span>
                  {normalizeTxStatus(t.status) === "upcoming" && <PayButton id={t.id} />}
                </div>
                <div className="flex items-center gap-1">
                  <TransactionFormModal
                    transaction={t}
                    projects={projects}
                    accounts={accounts}
                    categories={categories}
                    contacts={contacts}
                  />
                  <DeleteButton
                    action={deleteTransaction}
                    id={t.id}
                    confirmText="Διαγραφή κίνησης;"
                  />
                </div>
              </div>
            </Card>
          ))
        )}
        {transactions.length > 0 && (
          <Card className="flex items-center justify-between p-4">
            <span className="text-sm font-medium">Καθαρό σύνολο</span>
            <span className={`font-bold ${netBalance >= 0 ? "text-primary" : "text-negative"}`}>
              {formatEuro(netBalance)}
            </span>
          </Card>
        )}
      </div>

      {/* Tablet / Desktop: πίνακας */}
      <Card className="hidden overflow-hidden md:block">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-slate-50 text-left text-xs text-muted">
                <th className="px-4 py-2 font-medium">Ημ/νία</th>
                <th className="px-4 py-2 font-medium">Έργο</th>
                <th className="px-4 py-2 font-medium">Περιγραφή</th>
                <th className="px-4 py-2 font-medium">Κατάσταση</th>
                <th className="px-4 py-2 font-medium">Πηγή</th>
                <th className="px-4 py-2 font-medium">Τύπος</th>
                <th className="px-4 py-2 font-medium">ΦΠΑ</th>
                <th className="px-4 py-2 text-right font-medium">Ποσό</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {transactions.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-muted">
                    Δεν υπάρχουν κινήσεις.
                  </td>
                </tr>
              ) : (
                transactions.map((t) => (
                  <tr key={t.id} className="border-b border-border last:border-0">
                    <td className="px-4 py-2 whitespace-nowrap">
                      {formatDate(t.tx_date)}
                    </td>
                    <td className="px-4 py-2">{projName(t.project_id)}</td>
                    <td className="px-4 py-2">{t.notes || "—"}</td>
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted">{TX_ACTIVE_STATUS_LABEL[normalizeTxStatus(t.status)]}</span>
                        {normalizeTxStatus(t.status) === "upcoming" && <PayButton id={t.id} label="" />}
                      </div>
                    </td>
                    <td className="px-4 py-2 text-xs text-muted">{t.source || "—"}</td>
                    <td className="px-4 py-2 text-xs text-muted">{TX_TYPE_LABEL[t.type]}</td>
                    <td className="px-4 py-2 text-xs text-muted">{t.has_invoice ? "Με ΦΠΑ" : "Χωρίς ΦΠΑ"}</td>
                    <td
                      className={`px-4 py-2 text-right font-semibold ${
                        t.type === "income" ? "text-positive" : ""
                      }`}
                    >
                      {t.type === "income" ? "+" : "−"}
                      {formatEuro(num(t.amount))}
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex items-center justify-end gap-1">
                        <TransactionFormModal
                          transaction={t}
                          projects={projects}
                          accounts={accounts}
                          categories={categories}
                          contacts={contacts}
                        />
                        <DeleteButton
                          action={deleteTransaction}
                          id={t.id}
                          confirmText="Διαγραφή κίνησης;"
                        />
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
            {transactions.length > 0 && (
              <tfoot>
                <tr className="border-t border-border bg-slate-50">
                  <td colSpan={7} className="px-4 py-2 font-medium">
                    Καθαρό σύνολο (έσοδα − έξοδα)
                  </td>
                  <td className={`px-4 py-2 text-right font-bold ${netBalance >= 0 ? "text-primary" : "text-negative"}`}>
                    {formatEuro(netBalance)}
                  </td>
                  <td></td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </Card>
    </div>
  );
}
