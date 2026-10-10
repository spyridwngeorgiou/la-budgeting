import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui";
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
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">{el.nav.projects}</h1>
          <p className="mt-1 text-sm text-ink-muted">
            Προϋπολογισμός, πορεία και κατάσταση κάθε έργου. Μπείτε σε ένα έργο για δάνεια, μίσθωση
            και σημειώσεις.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Link href="/projects/revenue-plans">
            <Button variant="secondary">{el.nav.revenuePlans}</Button>
          </Link>
          <Link href="/collab">
            <Button variant="secondary">{el.collab.navLabel}</Button>
          </Link>
          <ProjectFormModal action={createProject} />
        </div>
      </div>

      <ProjectsGrid rollup={rollup ?? []} noBudgetIds={noBudgetIds} />
    </div>
  );
}
