import type { SubNavTab } from "@/lib/navigation";
import type { OrgRole } from "@/lib/domain/enums";
import { projects as t } from "@/lib/i18n/v2/projects";

// The five tabs of /projects/[id] (v2). Επισκόπηση is the segment's own
// page; the rest are /projects/[id]/<tab>, one dynamic segment
// ([tab]/page.tsx) so the (app) page count does not grow.
//
// External partners see only Πλάνο and Συνεργασία -- never money. The
// (app) layout sends partners to /collab today; this is the second line
// for when Phase 6 lets them in.

export const TAB_SEGMENTS = ["finance", "scenarios", "plan", "collab"] as const;
export type TabSegment = (typeof TAB_SEGMENTS)[number];
export type ProjectTab = "overview" | TabSegment;

const PARTNER_TABS: readonly ProjectTab[] = ["plan", "collab"];

export const isTabSegment = (s: string): s is TabSegment => (TAB_SEGMENTS as readonly string[]).includes(s);

export function tabAllowed(tab: ProjectTab, role: OrgRole | "partner" | null): boolean {
  if (role === null) return false;
  return role === "partner" ? PARTNER_TABS.includes(tab) : true;
}

// Where someone lands who opened a tab they may not see.
export function fallbackTab(projectId: string, role: OrgRole | "partner" | null): string {
  return role === "partner" ? `/projects/${projectId}/plan` : `/projects/${projectId}`;
}

export function projectTabs(projectId: string, role: OrgRole | "partner" | null): SubNavTab[] {
  const all: { tab: ProjectTab; href: string; label: string }[] = [
    { tab: "overview", href: `/projects/${projectId}`, label: t.tabs.overview },
    { tab: "finance", href: `/projects/${projectId}/finance`, label: t.tabs.finance },
    { tab: "scenarios", href: `/projects/${projectId}/scenarios`, label: t.tabs.scenarios },
    { tab: "plan", href: `/projects/${projectId}/plan`, label: t.tabs.plan },
    { tab: "collab", href: `/projects/${projectId}/collab`, label: t.tabs.collab },
  ];
  return all.filter((x) => tabAllowed(x.tab, role)).map(({ href, label }) => ({ href, label }));
}
