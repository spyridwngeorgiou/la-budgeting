"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { buttonClass } from "@/components/ui";

// «Εξαγωγή CSV» beside «Παρουσίαση» / «Εκτύπωση» on the report tabs that
// have an export (/api/reports/<tab>/export), carrying the tab's own filters
// (year, by, scheduled / scenario, scope, months) so the file is what the
// page shows. Nothing on the other tabs.
const EXPORTS: Record<string, string> = {
  "/reports/pnl": "/api/reports/pnl/export",
  "/reports/cash": "/api/reports/cash/export",
  "/reports/net-worth": "/api/reports/net-worth/export",
};
// Page-only state (the selected month, a drill-down cell, presenting).
const DROP = ["month", "cell", "line", "present"];

export function ExportCsvLink() {
  const pathname = (usePathname() ?? "").replace(/\/+$/, "");
  const search = useSearchParams();
  const api = EXPORTS[pathname];
  if (!api) return null;
  const params = new URLSearchParams(search?.toString() ?? "");
  for (const k of DROP) params.delete(k);
  const q = params.toString();
  return (
    <a href={q ? `${api}?${q}` : api} download className={buttonClass("secondary", "md", "present-hide print-hide")}>
      Εξαγωγή CSV
    </a>
  );
}
