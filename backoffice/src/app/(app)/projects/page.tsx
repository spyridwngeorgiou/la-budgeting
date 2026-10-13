import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { ButtonLink, PageHeader } from "@/components/ui";
import { getCurrentOrgId } from "@/lib/supabase/org";
import { el } from "@/lib/i18n/el";
import { ProjectFormModal } from "./LegacyFormModals";
import { ProjectsGrid, type ProjectCard } from "./ProjectsGrid";
import { createProject } from "./actions";

export default async function ProjectsPage() {
  const supabase = await createClient();
  const orgId = await getCurrentOrgId(supabase);

  // "No budget" and "budget of zero" are different facts, and v_project_rollup
  // coalesces both to 0. The existence signal comes from the QC view that
  // already defines it, so there is one definition of "has a budget".
  // The card's figures are the project page's ΠΡΟΫΠΟΛΟΓΙΣΜΟΣ and the
  // overview's portfolio: total_budget, capex_paid, capex_committed and
  // remaining_budget (= budget − paid − committed; only capex consumes a
  // budget, 0020).
  const [{ data: rollup }, { data: withoutBudget }] = await Promise.all([
    supabase
      .from("v_project_rollup")
      .select("project_id, display_name, status, total_budget, capex_paid, capex_committed, remaining_budget")
      .eq("org_id", orgId)
      .order("code"),
    supabase.from("v_qc_projects_without_budget").select("project_id").eq("org_id", orgId),
  ]);

  const noBudget = new Set((withoutBudget ?? []).map((r) => r.project_id).filter((id): id is string => id !== null));
  // Only what the cards show goes to the client.
  const projects: ProjectCard[] = (rollup ?? [])
    .filter((r): r is typeof r & { project_id: string } => r.project_id !== null)
    .map((r) => ({
      id: r.project_id,
      name: r.display_name ?? "",
      status: r.status,
      budget: noBudget.has(r.project_id) ? null : Number(r.total_budget ?? 0),
      paid: Number(r.capex_paid ?? 0),
      committed: Number(r.capex_committed ?? 0),
      remaining: Number(r.remaining_budget ?? 0),
    }));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={el.nav.projects}
        meta={
          <span className="block max-w-prose">
            Προϋπολογισμός, πορεία και κατάσταση κάθε έργου. Μπείτε σε ένα έργο για δάνεια, μίσθωση
            και σημειώσεις.{" "}
            <Link href="/collab" className="whitespace-nowrap text-ink underline-offset-4 hover:underline max-md:inline-flex max-md:min-h-11 max-md:items-center">
              {el.collab.navLabel} →
            </Link>
          </span>
        }
        actions={
          <>
            <ButtonLink href="/projects/revenue-plans">{el.nav.revenuePlans}</ButtonLink>
            <ProjectFormModal action={createProject} />
          </>
        }
      />

      <ProjectsGrid projects={projects} />
    </div>
  );
}
