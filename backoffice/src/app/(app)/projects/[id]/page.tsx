import { getUiVersion } from "@/lib/ui/version";
import { OverviewTab } from "@/features/projects/OverviewTab";
import { LegacyProjectPage } from "./LegacyProjectPage";

// Classic look: the one-pager. New look: the Επισκόπηση tab under the
// header of ./layout.tsx.
export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if ((await getUiVersion("app")) === "v1") return <LegacyProjectPage id={id} />;
  return <OverviewTab id={id} />;
}
