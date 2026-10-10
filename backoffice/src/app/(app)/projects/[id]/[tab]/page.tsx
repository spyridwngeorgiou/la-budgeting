import { notFound, redirect } from "next/navigation";
import { getUiVersion } from "@/lib/ui/version";
import { isTabSegment } from "@/features/projects/tabs";
import { FinanceTab } from "@/features/projects/FinanceTab";
import { ScenariosTab } from "@/features/projects/ScenariosTab";
import { PlanTab } from "@/features/projects/PlanTab";
import { CollabTab } from "@/features/projects/CollabTab";
import { LegacyComparePage } from "../LegacyComparePage";

// The project tabs Οικονομικά · Σενάρια · Πλάνο · Συνεργασία, one segment
// (/projects/[id]/<tab>) so the (app) page count stays within budget. It
// also answers the classic /projects/[id]/compare until Phase 7, whose
// comparison now lives in Σενάρια for the new look.
export default async function ProjectTabPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; tab: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ id, tab }, version] = await Promise.all([params, getUiVersion("app")]);

  if (tab === "compare") {
    if (version === "v1") return <LegacyComparePage id={id} />;
    redirect(`/projects/${id}/scenarios#compare`);
  }
  if (!isTabSegment(tab)) notFound();
  // The tabs are the new look only.
  if (version === "v1") redirect(`/projects/${id}`);

  switch (tab) {
    case "finance":
      return <FinanceTab id={id} />;
    case "scenarios":
      return <ScenariosTab id={id} searchParams={await searchParams} />;
    case "plan":
      return <PlanTab id={id} />;
    case "collab":
      return <CollabTab id={id} />;
  }
}
