import type { SubNavTab } from "@/lib/navigation";
import { money as t } from "@/lib/i18n/v2/money";
import { withParams } from "@/lib/url";

// The five tabs of /money, one optional catch-all segment
// (money/[[...tab]]/page.tsx) so the (app) page count does not grow:
// /money (= /money/transactions) · /money/flow · /money/accounts ·
// /money/contacts · /money/reports?view=pnl|taxes|assets.

export const MONEY_TABS = ["transactions", "flow", "accounts", "contacts", "reports"] as const;
export type MoneyTab = (typeof MONEY_TABS)[number];

export const REPORT_VIEWS = ["pnl", "taxes", "assets"] as const;
export type ReportView = (typeof REPORT_VIEWS)[number];

type Params = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

// The tab a URL's segments name, or null (-> 404).
export function parseMoneyTab(slug: string[] | undefined): MoneyTab | null {
  if (!slug || slug.length === 0) return "transactions";
  if (slug.length > 1) return null;
  return (MONEY_TABS as readonly string[]).includes(slug[0]) ? (slug[0] as MoneyTab) : null;
}

export function parseReportView(v: string | string[] | undefined): ReportView {
  const s = one(v);
  return (REPORT_VIEWS as readonly string[]).includes(s ?? "") ? (s as ReportView) : "pnl";
}

export const moneyHref = (tab: MoneyTab) => (tab === "transactions" ? "/money" : `/money/${tab}`);

export function moneyTabs(): SubNavTab[] {
  return MONEY_TABS.map((tab) => ({ href: moneyHref(tab), label: t.tabs[tab] }));
}

// The classic look has no /money: each tab goes to the page it replaces.
// Κινήσεις and Ροή keep their filters (the legacy pages read the same
// parameter names); the others have nothing to carry.
const LEGACY_REPORT: Record<ReportView, string> = {
  pnl: "/reports/pnl",
  taxes: "/reports/vat",
  assets: "/reports/net-worth",
};
const CARRIED: Record<"transactions" | "flow", string[]> = {
  transactions: ["status", "direction", "project_id", "account_id", "contact_id", "category_id", "scope", "from", "to", "ids"],
  flow: ["scenario", "scope", "months", "month"],
};

export function legacyHref(tab: MoneyTab, sp: Params): string {
  switch (tab) {
    case "transactions":
    case "flow": {
      const kept = Object.fromEntries(CARRIED[tab].map((k) => [k, one(sp[k])]));
      return withParams(tab === "flow" ? "/reports/cash" : "/transactions", kept);
    }
    case "accounts":
      return "/accounts";
    case "contacts":
      return "/contacts";
    case "reports":
      return LEGACY_REPORT[parseReportView(sp.view)];
  }
}
