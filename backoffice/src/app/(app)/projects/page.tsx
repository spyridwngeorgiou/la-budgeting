import { createClient } from "@/lib/supabase/server";
import { el } from "@/lib/i18n/el";
import { ProjectFormModal } from "./ProjectFormModal";
import { ProjectsGrid } from "./ProjectsGrid";
import { createProject } from "./actions";

export default async function ProjectsPage() {
  const supabase = await createClient();
  const { data: rollup } = await supabase
    .from("v_project_rollup")
    .select("*")
    .order("code");

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">{el.nav.projects}</h1>
        <ProjectFormModal action={createProject} />
      </div>

      <ProjectsGrid rollup={rollup ?? []} />
    </div>
  );
}
