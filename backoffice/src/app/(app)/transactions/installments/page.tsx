import { createClient } from "@/lib/supabase/server";
import { getCurrentOrgId } from "@/lib/supabase/org";
import { formatMoney, formatDate } from "@/lib/format";
import { el } from "@/lib/i18n/el";
import { Badge, Button, EmptyState, PageHeader, SpecTable, Stat, StatRow, StatusDot, Td, Tr } from "@/components/ui";
import { InstallmentPlanFormModal } from "./InstallmentPlanFormModal";
import { createInstallmentPlan, regeneratePlan, markInstallmentPaid } from "./actions";
import { loadLookups } from "@/lib/data/lookups";

export default async function InstallmentsPage() {
  const supabase = await createClient();
  const orgId = await getCurrentOrgId(supabase);

  const [
    { data: progress },
    { data: plans },
    { contacts, projects, categories, accounts },
    { data: installments },
  ] = await Promise.all([
    supabase.from("v_plan_progress").select("*").eq("org_id", orgId),
    supabase.from("installment_plans").select("id, label").eq("org_id", orgId),
    loadLookups(supabase, orgId),
    supabase
      .from("transactions")
      .select("id, plan_id, installment_no, tx_date, due_date, status, gross_amount")
      .eq("org_id", orgId)
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
    <div className="flex flex-col gap-10">
      <PageHeader
        title={el.nav.installments}
        meta="Δόσεις προς τρίτους (π.χ. ρυθμίσεις φόρων, οφειλές) που δεν είναι δάνειο έργου."
        actions={
          <InstallmentPlanFormModal
            action={createInstallmentPlan}
            contacts={contactOptions}
            projects={projectOptions}
            categories={categoryOptions}
            accounts={accountOptions}
          />
        }
      />

      {(progress ?? []).length === 0 && (
        <EmptyState
          title="Δεν υπάρχουν ακόμα σχέδια δόσεων."
          body="Πατήστε «+ Νέο Σχέδιο Δόσεων» για να δημιουργήσετε το πρώτο (π.χ. ενοίκιο, δάνειο, εγγύηση σε δόσεις)."
        />
      )}

      {(progress ?? []).map((plan) => {
        const rows = installmentsByPlan.get(plan.plan_id!) ?? [];
        return (
          <section
            key={plan.plan_id}
            className={`flex flex-col gap-4 ${plan.overdue_count ? "border-l-2 border-negative pl-4" : ""}`}
          >
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-hairline pb-3">
              <h2 className="min-w-0 text-section font-normal break-words text-ink">
                {planLabels.get(plan.plan_id!) ?? plan.label}
              </h2>
              <div className="flex items-center gap-2">
                {plan.overdue_count ? (
                  <Badge tone="negative">
                    <span className="num">{plan.overdue_count}</span> ληξιπρόθεσμες
                  </Badge>
                ) : null}
                <form action={regeneratePlan.bind(null, plan.plan_id!)}>
                  <Button type="submit" variant="secondary" size="sm">
                    Ανανέωση
                  </Button>
                </form>
              </div>
            </div>

            <StatRow className="border-t-0 pt-0">
              <Stat label="Πληρωμένες" value={`${plan.paid_count} / ${plan.installments_total}`} />
              <Stat label="Πληρωμένο Ποσό" value={formatMoney(plan.paid_amount)} />
              <Stat label="Υπόλοιπο" value={formatMoney(plan.remaining_amount)} />
              <Stat label="Επόμενη Δόση" value={plan.next_due_date ? formatDate(plan.next_due_date) : "—"} />
            </StatRow>

            <details className="group">
              <summary className="eyebrow inline-flex min-h-11 cursor-pointer items-center gap-2 text-muted hover:text-ink md:min-h-9">
                <span aria-hidden="true" className="inline-block transition-transform group-open:rotate-90">
                  ›
                </span>
                Δόσεις (<span className="num">{rows.length}</span>)
              </summary>
              <SpecTable label="Δόσεις" className="mt-2">
                <tbody className="border-t border-rule">
                  {rows.map((tx) => (
                    <Tr key={tx.id}>
                      <Td className="num">
                        <span className="text-muted">#{tx.installment_no}</span>
                      </Td>
                      <Td className="num">{formatDate(tx.due_date)}</Td>
                      <Td numeric strong>
                        {formatMoney(tx.gross_amount)}
                      </Td>
                      <Td>
                        <StatusDot
                          tone={tx.status === "paid" ? "neutral" : "warning"}
                          label={el.transaction[tx.status as "paid" | "pending" | "scheduled" | "cancelled"]}
                        />
                      </Td>
                      <Td className="text-right">
                        {tx.status !== "paid" && (
                          <form action={markInstallmentPaid.bind(null, tx.id)}>
                            <Button type="submit" variant="secondary" size="sm">
                              {el.common.markPaid}
                            </Button>
                          </form>
                        )}
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </SpecTable>
            </details>
          </section>
        );
      })}
    </div>
  );
}
