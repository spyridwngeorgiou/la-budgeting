import { createClient } from "@/lib/supabase/server";
import { getCurrentOrgId } from "@/lib/supabase/org";
import { formatMoney, formatDate } from "@/lib/format";
import { el } from "@/lib/i18n/el";
import { shell } from "@/lib/i18n/v2/shell";
import { Badge, Button, EmptyState, PageHeader, ReportHistory, SUB_CLASS, SpecTable, StatusDot, Td, Th, Tr } from "@/components/ui";
import { InstallmentPlanFormModal } from "./InstallmentPlanFormModal";
import { regeneratePlan, markInstallmentPaid } from "./actions";
import { loadLookups } from "@/lib/data/lookups";
import { ArgsActionForm } from "@/components/ArgsActionForm";

const p = el.transaction.plans;

type InstalmentRow = {
  id: string;
  installment_no: number | null;
  due_date: string | null;
  status: string;
  gross_amount: number | null;
};

// A plan's schedule, under «▸ Πρόγραμμα (N)».
function ScheduleTable({ rows }: { rows: InstalmentRow[] }) {
  return (
    <SpecTable label={p.schedule}>
      <thead>
        <tr>
          <Th numeric className="w-16">
            {p.number}
          </Th>
          <Th>{p.due}</Th>
          <Th numeric>{el.transaction.amount}</Th>
          <Th>{el.transaction.status}</Th>
          <Th>
            <span className="sr-only">{shell.ui.actions}</span>
          </Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((tx) => (
          <Tr key={tx.id} className="[&>td]:align-middle">
            <Td numeric className="text-muted">
              {tx.installment_no}
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
            <Td className="py-1.5 text-right">
              {tx.status !== "paid" && (
                <ArgsActionForm action={markInstallmentPaid} args={[tx.id]}>
                  <Button type="submit" variant="secondary" size="sm">
                    {el.common.markPaid}
                  </Button>
                </ArgsActionForm>
              )}
            </Td>
          </Tr>
        ))}
      </tbody>
    </SpecTable>
  );
}

// Δόσεις: one row per plan -- what is paid of the total, the next due date,
// what is left and «Ανανέωση» -- and its schedule one click away. A plan
// with overdue instalments opens its schedule, so they are in sight.
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

  const planLabels = new Map((plans ?? []).map((pl) => [pl.id, pl.label]));
  const installmentsByPlan = new Map<string, InstalmentRow[]>();
  for (const tx of installments ?? []) {
    if (!tx.plan_id) continue;
    const list = installmentsByPlan.get(tx.plan_id) ?? [];
    list.push(tx);
    installmentsByPlan.set(tx.plan_id, list);
  }

  const contactOptions = (contacts ?? []).map((c) => ({ id: c.id, label: c.name }));
  const projectOptions = (projects ?? []).map((pr) => ({ id: pr.id, label: pr.display_name }));
  const categoryOptions = (categories ?? []).map((c) => ({ id: c.id, label: c.name }));
  const accountOptions = (accounts ?? []).map((a) => ({ id: a.id, label: a.name }));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={el.nav.installments}
        meta="Δόσεις προς τρίτους (π.χ. ρυθμίσεις φόρων, οφειλές) που δεν είναι δάνειο έργου."
        actions={
          <InstallmentPlanFormModal
            contacts={contactOptions}
            projects={projectOptions}
            categories={categoryOptions}
            accounts={accountOptions}
          />
        }
      />

      {(progress ?? []).length === 0 ? (
        <EmptyState title={p.empty} body={p.emptyHint} />
      ) : (
        <SpecTable label={el.nav.installments}>
          <thead>
            <tr>
              <Th>{p.plan}</Th>
              <Th numeric>{p.paid}</Th>
              <Th>{p.next}</Th>
              <Th numeric>{p.remaining}</Th>
              <Th>
                <span className="sr-only">{shell.ui.actions}</span>
              </Th>
            </tr>
          </thead>
          {(progress ?? []).map((plan) => {
            const rows = installmentsByPlan.get(plan.plan_id!) ?? [];
            return (
              // One body per plan: its row, then its schedule.
              <tbody key={plan.plan_id}>
                <Tr className="[&>td]:border-b-0 [&>td]:align-middle">
                  <Td className="min-w-48">
                    <h2 className="inline text-body font-normal break-words text-ink">{planLabels.get(plan.plan_id!) ?? plan.label}</h2>
                    {plan.overdue_count ? (
                      <Badge tone="negative" className="ml-2">
                        <span className="num">{plan.overdue_count}</span> {p.overdue}
                      </Badge>
                    ) : null}
                  </Td>
                  <Td numeric>
                    <span className="text-ink">
                      {plan.paid_count} / {plan.installments_total}
                    </span>
                    <span className={SUB_CLASS}>
                      {formatMoney(plan.paid_amount)} {p.paidAmount}
                    </span>
                  </Td>
                  <Td className="num">{plan.next_due_date ? formatDate(plan.next_due_date) : "—"}</Td>
                  <Td numeric strong>
                    {formatMoney(plan.remaining_amount)}
                  </Td>
                  <Td className="py-1.5 text-right">
                    <ArgsActionForm action={regeneratePlan} args={[plan.plan_id!]}>
                      <Button type="submit" variant="ghost" size="sm">
                        {p.regenerate}
                      </Button>
                    </ArgsActionForm>
                  </Td>
                </Tr>
                <tr className="[&>td]:border-b-0 [&>td]:pt-0">
                  <Td colSpan={5} className="pb-4">
                    <ReportHistory title={p.schedule} count={rows.length} level={3} open={!!plan.overdue_count}>
                      <ScheduleTable rows={rows} />
                    </ReportHistory>
                  </Td>
                </tr>
              </tbody>
            );
          })}
        </SpecTable>
      )}
    </div>
  );
}
