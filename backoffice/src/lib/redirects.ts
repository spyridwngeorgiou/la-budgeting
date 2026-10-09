// Old URLs from before the 11-item navigation (bookmarks, AI answers,
// emails), applied by next.config.ts redirects(). Temporary (307) for now;
// flip to permanent once the new layout has settled. No imports: next.config
// loads this file directly.
export const LEGACY_REDIRECTS: { source: string; destination: string }[] = [
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
];
