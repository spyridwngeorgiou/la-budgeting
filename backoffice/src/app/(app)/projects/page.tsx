import { createClient } from "@/lib/supabase/server";
import { el } from "@/lib/i18n/el";
import { ProjectFormModal } from "./ProjectFormModal";
import { ProjectsGrid } from "./ProjectsGrid";
import { createProject } from "./actions";

export default async function ProjectsPage() {
  const supabase = await createClient();

  // "No budget" and "budget of zero" are different facts, and v_project_rollup
  // coalesces both to 0. The existence signal comes from the QC view that
  // already defines it, so there is one definition of "has a budget".
  const [{ data: rollup }, { data: withoutBudget }] = await Promise.all([
    supabase.from("v_project_rollup").select("*").order("code"),
    supabase.from("v_qc_projects_without_budget").select("project_id"),
  ]);

  const noBudgetIds = (withoutBudget ?? [])
    .map((r) => r.project_id)
    .filter((id): id is string => id !== null);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">{el.nav.projects}</h1>
          <p className="mt-1 text-sm text-ink-muted">
            Προϋπολογισμός, πορεία και κατάσταση κάθε έργου. Μπείτε σε ένα έργο για δάνεια, μίσθωση
            και σημειώσεις.
          </p>
        </div>
        <ProjectFormModal action={createProject} />
      </div>

      <ProjectsGrid rollup={rollup ?? []} noBudgetIds={noBudgetIds} />
    </div>
  );
}
