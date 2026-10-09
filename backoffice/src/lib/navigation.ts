import { el } from "@/lib/i18n/el";

// Tabs of each top-level section, rendered by <SubNav> in that section's
// layout. Every tab is a real route; to add one (P&L, net worth, deals…)
// create the page and append an entry here.

export interface SubNavTab {
  href: string;
  label: string;
}

export const SECTION_TABS = {
  transactions: [
    { href: "/transactions", label: el.tabs.transactionsAll },
    { href: "/transactions/installments", label: el.tabs.installments },
    { href: "/transactions/analysis", label: el.tabs.analysis },
  ],
  projects: [
    { href: "/projects", label: el.tabs.projectsAll },
    { href: "/projects/properties", label: el.tabs.properties },
  ],
  reports: [
    { href: "/reports/cash", label: el.tabs.cash },
    { href: "/reports/vat", label: el.tabs.vat },
    { href: "/reports/withholding", label: el.tabs.withholding },
    { href: "/reports/quality", label: el.tabs.quality },
  ],
  planner: [
    { href: "/planner", label: el.planner.tabs.board },
    { href: "/planner/timeline", label: el.planner.tabs.timeline },
    { href: "/planner/calendar", label: el.planner.tabs.calendar },
  ],
} satisfies Record<string, SubNavTab[]>;

// The tab owning `pathname`: the longest href that is the path itself or a
// parent of it, so /planner/task/1 lights «Εργασίες» and /transactions/analysis
// lights «Ανάλυση», not «Όλες».
export function activeTab(tabs: SubNavTab[], pathname: string): string | null {
  let best: string | null = null;
  for (const t of tabs) {
    if ((pathname === t.href || pathname.startsWith(`${t.href}/`)) && (!best || t.href.length > best.length)) {
      best = t.href;
    }
  }
  return best;
}
