import { revalidatePath } from "next/cache";

// A project's page and every tab under it: the v2 tabs (finance, scenarios,
// plan, collab) are nested segments of /projects/[id], so a write
// refreshes the whole layout, not only the overview.
export function revalidateProject(projectId: string) {
  revalidatePath(`/projects/${projectId}`);
  revalidatePath("/projects/[id]", "layout");
}
