// Old URLs from before the 11-item navigation (bookmarks, AI answers,
// emails), applied by next.config.ts redirects(). Temporary (307) for now;
// flip to permanent once the new layout has settled. No imports: next.config
// loads this file directly. The request's query is passed through. The first
// matching entry wins, so a `has` variant goes before its plain fallback.
export const LEGACY_REDIRECTS: {
  source: string;
  destination: string;
  has?: { type: "query"; key: string; value?: string }[];
}[] = [
  // «Αναφορές» opens on its first tab (was a page of its own, a bare
  // redirect; moved here in Φ3 to save a page).
  { source: "/reports", destination: "/reports/cash" },
  { source: "/analysis", destination: "/transactions/analysis" },
  { source: "/installments", destination: "/transactions/installments" },
  { source: "/properties", destination: "/projects/properties" },
  { source: "/cashflow", destination: "/reports/cash" },
  { source: "/vat", destination: "/reports/vat" },
  { source: "/withholding", destination: "/reports/withholding" },
  { source: "/quality", destination: "/reports/quality" },
  { source: "/changes", destination: "/assistant?panel=changes" },
  { source: "/revenue-plans", destination: "/projects/revenue-plans" },
  { source: "/revenue-plans/:id", destination: "/projects/revenue-plans/:id" },
  // Phase 6: the planner is one page with a view switch. The request's own
  // query (project, assignee, month…) is passed through and merged.
  { source: "/planner/timeline", destination: "/planner?view=timeline" },
  { source: "/planner/calendar", destination: "/planner?view=calendar" },
  // The v2 redesign («Χρήματα», the project tabs) was removed; its URLs land
  // on the classic page each tab stood for. Filters (status, project_id,
  // scenario, months…) use the same parameter names, so they carry over.
  { source: "/money", destination: "/transactions" },
  { source: "/money/transactions", destination: "/transactions" },
  { source: "/money/flow", destination: "/reports/cash" },
  { source: "/money/accounts", destination: "/accounts" },
  { source: "/money/contacts", destination: "/contacts" },
  { source: "/money/reports", has: [{ type: "query", key: "view", value: "taxes" }], destination: "/reports/vat" },
  { source: "/money/reports", has: [{ type: "query", key: "view", value: "assets" }], destination: "/reports/net-worth" },
  { source: "/money/reports", destination: "/reports/pnl" },
  { source: "/projects/:id/overview", destination: "/projects/:id" },
  { source: "/projects/:id/finance", destination: "/projects/:id" },
  { source: "/projects/:id/scenarios", destination: "/projects/:id" },
  { source: "/projects/:id/plan", destination: "/projects/:id" },
  { source: "/projects/:id/collab", destination: "/projects/:id" },
];
