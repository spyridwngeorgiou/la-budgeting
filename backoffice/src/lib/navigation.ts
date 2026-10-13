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
    { href: "/projects/deals", label: el.tabs.deals },
  ],
  // Λογαριασμοί also keeps the hand-kept lists the reports read: assets &
  // liabilities (Καθαρή θέση) and expected income (Ταμείο). The reports
  // are read-only and link here to manage them.
  accounts: [
    { href: "/accounts", label: el.tabs.accountsAll },
    { href: "/accounts/assets", label: el.tabs.assetsLiabilities },
    { href: "/accounts/expected", label: el.tabs.expected },
  ],
  reports: [
    { href: "/reports/cash", label: el.tabs.cash },
    { href: "/reports/pnl", label: el.tabs.pnl },
    { href: "/reports/net-worth", label: el.tabs.netWorth },
    { href: "/reports/vat", label: el.tabs.vat },
    { href: "/reports/quality", label: el.tabs.quality },
    { href: "/reports/portfolio", label: el.tabs.portfolio },
  ],
  // The planner has no tabs: /planner is the task board; the calendar is
  // /calendar.
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
