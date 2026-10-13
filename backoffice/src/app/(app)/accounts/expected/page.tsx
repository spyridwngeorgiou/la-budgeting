import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrgId } from "@/lib/supabase/org";
import { formatMoney } from "@/lib/format";
import { el } from "@/lib/i18n/el";
import { Button, LINK_CLASS, PageHeader, SpecTable, Td, Tr } from "@/components/ui";
import { ArgsActionForm } from "@/components/ArgsActionForm";
import { loadLookups } from "@/lib/data/lookups";
import { monthKeyOf, monthLabel } from "@/lib/dates";
import type { ForecastScope } from "@/lib/finance/forecastParams";
import { ExpectedIncomeFormModal } from "./ExpectedIncomeFormModal";
import { saveExpectedIncome, setExpectedIncomeStatus } from "./actions";

// Αναμενόμενα έσοδα: the hand-kept list of likely money (0008 + 0065),
// moved as it was from the Ταμείο report, which now only reads it. Rows a
// project scenario wrote («Στείλε στο ταμείο», scenario_id set) show their
// project and scenario and are managed from the scenario, as before.
export default async function ExpectedIncomePage() {
  const supabase = await createClient();
  const orgId = await getCurrentOrgId(supabase);
  const [{ data: expected }, lookups] = await Promise.all([
    supabase
      .from("expected_income")
      .select(
        "id, source, amount, expected_month, probability, certainty, project_id, owner_scope, notes, scenario_id, direction, projects(display_name), project_scenarios(name)",
      )
      .eq("org_id", orgId)
      .eq("status", "expected")
      .order("expected_month"),
    loadLookups(supabase, orgId, { include: ["projects"] }),
  ]);
  const t = el.reports;

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <PageHeader
        title={t.expectedTitle}
        meta={
          <>
            Χρήματα που πιθανότατα θα έρθουν αλλά δεν έχουν τιμολογηθεί ακόμα· τα μετρά η{" "}
            <Link href="/reports/cash" className="text-ink underline underline-offset-4">
              {t.cashTitle}
            </Link>{" "}
            με την πιθανότητά τους.
          </>
        }
        actions={<ExpectedIncomeFormModal action={saveExpectedIncome} projects={lookups.projects} />}
      />

      {(expected ?? []).length === 0 ? (
        <p className="text-body text-muted">{t.expectedEmpty}</p>
      ) : (
        <SpecTable label={t.expectedTitle}>
          <tbody>
            {(expected ?? []).map((e) => {
              const project = Array.isArray(e.projects) ? e.projects[0] : e.projects;
              const scenario = Array.isArray(e.project_scenarios) ? e.project_scenarios[0] : e.project_scenarios;
              const probability = e.probability ?? (e.certainty === "certain" ? 1 : 0.5);
              return (
                <Tr key={e.id} className="[&>td]:align-middle">
                  <Td strong className="min-w-40">
                    {e.source}
                    {e.direction === "expense" && <span className="ml-1 text-small text-muted">({el.transaction.expense})</span>}
                    {project &&
                      (e.scenario_id && e.project_id ? (
                        <span className="ml-1 text-small text-muted">
                          ·{" "}
                          <Link href={`/projects/${e.project_id}`} className={LINK_CLASS}>
                            {project.display_name}
                          </Link>
                        </span>
                      ) : (
                        <span className="ml-1 text-small text-muted">· {project.display_name}</span>
                      ))}
                    {e.scenario_id && (
                      <span className="ml-1 text-small text-muted">
                        · {t.expectedFromScenario}
                        {scenario?.name ? ` «${scenario.name}»` : ""}
                      </span>
                    )}
                  </Td>
                  <Td className="whitespace-nowrap text-muted">{e.expected_month ? monthLabel(monthKeyOf(e.expected_month)) : "—"}</Td>
                  <Td numeric strong>
                    {formatMoney(e.amount)}
                  </Td>
                  <Td numeric className="text-small text-muted">
                    {Math.round(probability * 100)}%
                  </Td>
                  <Td className="py-1.5">
                    {!e.scenario_id && (
                      <div className="flex items-center justify-end gap-1">
                        <ExpectedIncomeFormModal
                          action={saveExpectedIncome}
                          id={e.id}
                          projects={lookups.projects}
                          trigger={el.common.edit}
                          initial={{
                            source: e.source,
                            amount: Number(e.amount),
                            expected_month: e.expected_month,
                            probability: e.probability,
                            project_id: e.project_id,
                            owner_scope: e.owner_scope as ForecastScope,
                            notes: e.notes,
                          }}
                        />
                        <ArgsActionForm action={setExpectedIncomeStatus} args={[e.id, "received"]}>
                          <Button type="submit" variant="ghost" size="sm">
                            {t.expectedReceived}
                          </Button>
                        </ArgsActionForm>
                        <ArgsActionForm action={setExpectedIncomeStatus} args={[e.id, "cancelled"]}>
                          <Button type="submit" variant="ghost" size="sm">
                            {t.expectedCancel}
                          </Button>
                        </ArgsActionForm>
                      </div>
                    )}
                  </Td>
                </Tr>
              );
            })}
          </tbody>
        </SpecTable>
      )}
    </div>
  );
}
