import { createClient } from "@/lib/supabase/server";
import { Card, Badge, Select, Button, Input } from "@/components/ui";
import { DeleteButton } from "@/components/DeleteButton";
import { formatEuro, formatDate } from "@/lib/utils";
import {
  TX_STATUS_LABEL,
  type Transaction,
  type Project,
  type Account,
  type Category,
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
  }>;
}) {
  const sp = await searchParams;
  const supabase = await createClient();

  const [txRes, projRes, accRes, catRes] = await Promise.all([
    supabase.from("transactions").select("*").order("tx_date", { ascending: false }),
    supabase.from("projects").select("*").order("name"),
    supabase.from("accounts").select("*").order("name"),
    supabase.from("categories").select("*").order("name"),
  ]);

  let transactions = (txRes.data ?? []) as Transaction[];
  const projects = (projRes.data ?? []) as Project[];
  const accounts = (accRes.data ?? []) as Account[];
  const categories = (catRes.data ?? []) as Category[];

  const projNameFor = (id: string | null) =>
    projects.find((p) => p.id === id)?.name ?? "";

  if (sp.project) transactions = transactions.filter((t) => t.project_id === sp.project);
  if (sp.status) transactions = transactions.filter((t) => t.status === sp.status);
  if (sp.type) transactions = transactions.filter((t) => t.type === sp.type);
  if (sp.q) {
    const q = sp.q.toLowerCase();
    transactions = transactions.filter((t) =>
      [t.notes, t.source, projNameFor(t.project_id)]
        .filter(Boolean)
        .some((s) => String(s).toLowerCase().includes(q)),
    );
  }

  const num = (n: number | string) => Number(n) || 0;
  const projName = (id: string | null) =>
    projects.find((p) => p.id === id)?.name ?? "—";

  const total = transactions.reduce(
    (s, t) => s + (t.type === "expense" ? num(t.amount) : -num(t.amount)),
    0,
  );

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
        />
      </div>

      {/* Filters (native GET form, works without JS) */}
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
            {Object.entries(TX_STATUS_LABEL).map(([v, l]) => (
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
      </form>

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
                  <p className="truncate font-medium">
                    {t.notes || projName(t.project_id)}
                  </p>
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
                <Badge tone={t.status}>{TX_STATUS_LABEL[t.status]}</Badge>
                <div className="flex items-center gap-1">
                  <TransactionFormModal
                    transaction={t}
                    projects={projects}
                    accounts={accounts}
                    categories={categories}
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
            <span className="font-bold text-primary">{formatEuro(total)}</span>
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
                <th className="px-4 py-2 text-right font-medium">Ποσό</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {transactions.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-muted">
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
                    <td className="px-4 py-2">
                      <span>{t.notes || "—"}</span>
                      {t.source ? (
                        <span className="block text-xs text-muted">{t.source}</span>
                      ) : null}
                    </td>
                    <td className="px-4 py-2">
                      <Badge tone={t.status}>{TX_STATUS_LABEL[t.status]}</Badge>
                    </td>
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
                  <td colSpan={4} className="px-4 py-2 font-medium">
                    Καθαρό σύνολο (έξοδα − έσοδα)
                  </td>
                  <td className="px-4 py-2 text-right font-bold text-primary">
                    {formatEuro(total)}
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
