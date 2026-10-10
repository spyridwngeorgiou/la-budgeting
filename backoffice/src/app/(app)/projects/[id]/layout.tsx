import { notFound } from "next/navigation";
import { getUiVersion } from "@/lib/ui/version";
import { isProjectId, loadProjectCore } from "@/features/projects/data";
import { ProjectHeader } from "@/features/projects/header/ProjectHeader";

// /projects/[id] in the new look: one header «Με μια ματιά» shared by the
// five tabs (Επισκόπηση is ./page.tsx, the rest ./[tab]/page.tsx), so
// switching tabs re-renders only the tab. The classic look renders the
// one-pager (./LegacyProjectPage.tsx) with no header from here.
export default async function ProjectLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  if ((await getUiVersion("app")) === "v1") return children;

  const { id } = await params;
  if (!isProjectId(id)) notFound();
  const core = await loadProjectCore(id);
  if (!core) notFound();

  return (
    <div className="flex flex-col gap-8">
      <ProjectHeader core={core} />
      {children}
    </div>
  );
}
