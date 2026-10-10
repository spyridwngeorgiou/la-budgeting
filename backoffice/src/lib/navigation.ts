import { el } from "@/lib/i18n/el";
import type { OrgRole } from "@/lib/domain/enums";
import { shell } from "@/lib/i18n/v2/shell";

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
  reports: [
    { href: "/reports/cash", label: el.tabs.cash },
    { href: "/reports/pnl", label: el.tabs.pnl },
    { href: "/reports/net-worth", label: el.tabs.netWorth },
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

// ---------------------------------------------------------------------------
// The v2 shell (src/components/shell): five destinations plus Settings.
// For now each points at today's route; the later phases only change the
// hrefs (Σήμερα -> "/", Χρήματα -> "/money" ...). budgets.test.ts keeps the
// menu at five.

export type DestinationKey = "today" | "inbox" | "money" | "projects" | "planner";

export interface Destination {
  key: DestinationKey;
  href: string;
  label: string;
  // Other route prefixes that light this destination.
  also?: string[];
  // Hidden below this role (RLS would refuse the writes anyway).
  minRole?: OrgRole;
  // Shown to external partners, at partnerHref.
  partnerHref?: string;
  // On the phone bottom bar (the rest are reached from the header).
  mobile?: boolean;
  // Carries the pending-approvals count.
  counted?: boolean;
}

export const NAV_V2: Destination[] = [
  { key: "today", href: "/", label: shell.nav.today, also: ["/dashboard"], mobile: true },
  {
    key: "inbox",
    href: "/inbox",
    label: shell.nav.inbox,
    also: ["/documents", "/aade", "/assistant"],
    minRole: "editor",
    counted: true,
  },
  {
    key: "money",
    href: "/money",
    label: shell.nav.money,
    also: ["/transactions", "/reports", "/accounts", "/contacts"],
    mobile: true,
  },
  // Partners: their projects live in the collaboration space until Phase 4
  // brings the project tabs (Πλάνο, Συνεργασία) into /projects/[id].
  { key: "projects", href: "/projects", label: shell.nav.projects, mobile: true, partnerHref: "/collab" },
  { key: "planner", href: "/planner", label: shell.nav.planner, mobile: true, partnerHref: "/collab" },
];

export const SETTINGS_V2 = { href: "/settings", label: shell.nav.settings } as const;

// «Ρώτα»: the assistant page for now; Phase 5 makes it a drawer.
export const ASK_V2 = { href: "/assistant", partnerHref: "/collab", label: shell.nav.ask } as const;

const ROLE_RANK: Record<OrgRole, number> = { viewer: 0, editor: 1, admin: 2, owner: 3 };

export type ShellRole = OrgRole | "partner";

// The destinations a role sees, with the href it should follow.
export function navForRole(role: ShellRole): Destination[] {
  if (role === "partner") {
    return NAV_V2.filter((d) => d.partnerHref).map((d) => ({ ...d, href: d.partnerHref!, also: [] }));
  }
  return NAV_V2.filter((d) => !d.minRole || ROLE_RANK[role] >= ROLE_RANK[d.minRole]);
}

// Only staff who can write may capture («＋ Καταχώριση»).
export const canCapture = (role: ShellRole) => role !== "partner" && ROLE_RANK[role] >= ROLE_RANK.editor;

const owns = (prefix: string, pathname: string) => pathname === prefix || pathname.startsWith(`${prefix}/`);

// The destination owning `pathname` (first match wins), or null (Settings,
// /design ...).
export function activeDestination(items: Destination[], pathname: string): Destination | null {
  return items.find((d) => owns(d.href, pathname) || (d.also ?? []).some((p) => owns(p, pathname))) ?? null;
}
