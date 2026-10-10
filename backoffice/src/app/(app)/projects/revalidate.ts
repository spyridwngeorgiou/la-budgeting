import { revalidatePath } from "next/cache";

// A project's page and every page under it (/projects/[id]/compare), so a
// write refreshes the whole segment, not only the one-pager.
export function revalidateProject(projectId: string) {
  revalidatePath(`/projects/${projectId}`);
  revalidatePath("/projects/[id]", "layout");
}
