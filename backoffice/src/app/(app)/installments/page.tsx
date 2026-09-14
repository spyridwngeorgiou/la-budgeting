import { createClient } from "@/lib/supabase/server";
import { formatMoney, formatDate } from "@/lib/format";
import { el } from "@/lib/i18n/el";
import { Badge, Button } from "@/components/ui";
import { InstallmentPlanFormModal } from "./InstallmentPlanFormModal";
import { createInstallmentPlan, regeneratePlan, markInstallmentPaid } from "./actions";

export default async function InstallmentsPage() {
  const supabase = await createClient();

  const [
    { data: progress },
    { data: plans },
    { data: contacts },
    { data: projects },
    { data: categories },
    { data: accounts },
    { data: installments },
  ] = await Promise.all([
    supabase.from("v_plan_progress").select("*"),
    supabase.from("installment_plans").select("id, label"),
    supabase.from("contacts").select("id, name").order("name"),
    supabase.from("projects").select("id, display_name").order("sort_order"),
    supabase.from("categories").select("id, name").order("sort_order"),
    supabase.from("accounts").select("id, name").order("sort_order"),
    supabase
      .from("transactions")
      .select("id, plan_id, installment_no, tx_date, due_date, status, gross_amount")
      .not("plan_id", "is", null)
      .order("installment_no"),
  ]);

  const planLabels = new Map((plans ?? []).map((p) => [p.id, p.label]));
  const installmentsByPlan = new Map<string, typeof installments>();
  for (const tx of installments ?? []) {
    if (!tx.plan_id) continue;
    const list = installmentsByPlan.get(tx.plan_id) ?? [];
    list.push(tx);
    installmentsByPlan.set(tx.plan_id, list);
  }

  const contactOptions = (contacts ?? []).map((c) => ({ id: c.id, label: c.name }));
  const projectOptions = (projects ?? []).map((p) => ({ id: p.id, label: p.display_name }));
  const categoryOptions = (categories ?? []).map((c) => ({ id: c.id, label: c.name }));
  const accountOptions = (accounts ?? []).map((a) => ({ id: a.id, label: a.name }));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">{el.nav.installments}</h1>
        <InstallmentPlanFormModal
          action={createInstallmentPlan}
          contacts={contactOptions}
          projects={projectOptions}
          categories={categoryOptions}
          accounts={accountOptions}
        />
      </div>

      {(progress ?? []).length === 0 && (
        <p className="p-6 text-center text-sm text-ink-muted">
          Δεν υπάρχουν ακόμα σχέδια δόσεων. Πατήστε «+ Νέο Σχέδιο Δόσεων» για να δημιουργήσετε το
          πρώτο (π.χ. ενοίκιο, δάνειο, εγγύηση σε δόσεις).
        </p>
      )}

      {(progress ?? []).map((plan) => {
        const rows = installmentsByPlan.get(plan.plan_id!) ?? [];
        return (
          <div key={plan.plan_id} className="rounded border border-line p-4">
            <div className="mb-2 flex items-center justify-between">
              <span className="font-medium">{planLabels.get(plan.plan_id!) ?? plan.label}</span>
              <div className="flex items-center gap-2">
                {plan.overdue_count ? (
                  <Badge tone="red">{plan.overdue_count} ληξιπρόθεσμες</Badge>
                ) : null}
                <form action={regeneratePlan.bind(null, plan.plan_id!)}>
                  <Button type="submit" variant="secondary" className="!px-2 !py-1 text-xs">
                    Ανανέωση
                  </Button>
                </form>
              </div>
            </div>

            <div className="mb-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
              <Stat label="Πληρωμένες" value={`${plan.paid_count} / ${plan.installments_total}`} />
              <Stat label="Πληρωμένο Ποσό" value={formatMoney(plan.paid_amount)} />
              <Stat label="Υπόλοιπο" value={formatMoney(plan.remaining_amount)} />
              <Stat
                label="Επόμενη Δόση"
                value={plan.next_due_date ? formatDate(plan.next_due_date) : "—"}
              />
            </div>

            <details>
              <summary className="cursor-pointer text-xs text-ink-muted">
                Δόσεις ({rows.length})
              </summary>
              <table className="mt-2 w-full text-left text-sm">
                <tbody>
                  {rows.map((tx) => (
                    <tr key={tx.id} className="border-t border-line">
                      <td className="p-1.5">#{tx.installment_no}</td>
                      <td className="p-1.5">{formatDate(tx.due_date)}</td>
                      <td className="p-1.5 text-right font-mono">{formatMoney(tx.gross_amount)}</td>
                      <td className="p-1.5">
                        <Badge tone={tx.status === "paid" ? "green" : "amber"}>
                          {el.transaction[tx.status as "paid" | "pending" | "scheduled" | "cancelled"]}
                        </Badge>
                      </td>
                      <td className="p-1.5">
                        {tx.status !== "paid" && (
                          <form action={markInstallmentPaid.bind(null, tx.id)}>
                            <Button type="submit" variant="secondary" className="!px-2 !py-1 text-xs">
                              {el.common.markPaid}
                            </Button>
                          </form>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          </div>
        );
      })}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-ink-muted">{label}</div>
      <div className="font-mono">{value}</div>
    </div>
  );
}
