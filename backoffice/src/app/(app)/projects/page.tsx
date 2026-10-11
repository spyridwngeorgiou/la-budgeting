import { createClient } from "@/lib/supabase/server";
import { ButtonLink, PageHeader } from "@/components/ui";
import { getCurrentOrgId } from "@/lib/supabase/org";
import { el } from "@/lib/i18n/el";
import { ProjectFormModal } from "./LegacyFormModals";
import { ProjectsGrid } from "./ProjectsGrid";
import { createProject } from "./actions";

export default async function ProjectsPage() {
  const supabase = await createClient();
  const orgId = await getCurrentOrgId(supabase);

  // "No budget" and "budget of zero" are different facts, and v_project_rollup
  // coalesces both to 0. The existence signal comes from the QC view that
  // already defines it, so there is one definition of "has a budget".
  const [{ data: rollup }, { data: withoutBudget }] = await Promise.all([
    supabase.from("v_project_rollup").select("*").eq("org_id", orgId).order("code"),
    supabase.from("v_qc_projects_without_budget").select("project_id").eq("org_id", orgId),
  ]);

  const noBudgetIds = (withoutBudget ?? [])
    .map((r) => r.project_id)
    .filter((id): id is string => id !== null);

  return (
    <div className="flex flex-col gap-10">
      <PageHeader
        title={el.nav.projects}
        meta={
          <span className="block max-w-prose">
            Προϋπολογισμός, πορεία και κατάσταση κάθε έργου. Μπείτε σε ένα έργο για δάνεια, μίσθωση
            και σημειώσεις.
          </span>
        }
        actions={
          <>
            <ButtonLink href="/projects/revenue-plans">
              {el.nav.revenuePlans}
            </ButtonLink>
            <ButtonLink href="/collab">
              {el.collab.navLabel}
            </ButtonLink>
            <ProjectFormModal action={createProject} />
          </>
        }
      />

      <ProjectsGrid rollup={rollup ?? []} noBudgetIds={noBudgetIds} />
    </div>
  );
}
