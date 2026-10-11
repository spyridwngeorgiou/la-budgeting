import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { toCsv, csvResponseHeaders } from "@/lib/csv";
import { addMonths, currentYear, shortMonthLabel } from "@/lib/dates";
import { el } from "@/lib/i18n/el";
import { BUSINESS_LINES, pnlTable, type PnlGroup } from "@/lib/finance/pnl";
import { pnlCsv } from "@/lib/finance/reportCsv";
import { reportExportOrg } from "../../auth";

// «Εξαγωγή CSV» of /reports/pnl: the same pnl_summary() call with the same
// parameters as the page (year, by=line, scheduled=1), as the table shows it.
export async function GET(request: NextRequest) {
  const org = await reportExportOrg();
  if (org instanceof NextResponse) return org;

  const params = request.nextUrl.searchParams;
  const thisYear = currentYear();
  const yearRaw = Number(params.get("year"));
  const year = Number.isInteger(yearRaw) && yearRaw >= 2000 && yearRaw <= thisYear + 5 ? yearRaw : thisYear;
  const group: PnlGroup = params.get("by") === "line" ? "business_line" : "month";
  const withScheduled = params.get("scheduled") === "1";

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("pnl_summary", {
    p_org: org.orgId,
    p_from: `${year}-01-01`,
    p_to: `${year}-12-31`,
    p_group: group,
    p_include_scheduled: withScheduled,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const buckets =
    group === "month"
      ? Array.from({ length: 12 }, (_, i) => addMonths(`${year}-01`, i))
      : BUSINESS_LINES.filter((b) => (data ?? []).some((r) => r.bucket === b));
  const lines = el.reports.businessLines as Record<string, string>;
  const label = (b: string) => (group === "month" ? `${shortMonthLabel(b)} ${year}` : (lines[b] ?? b));
  const { header, rows } = pnlCsv(pnlTable(data ?? [], buckets), buckets, label);
  const suffix = `${year}${group === "business_line" ? "-klados" : ""}${withScheduled ? "-me-programmatismena" : ""}`;
  return new NextResponse(toCsv(header, rows), { headers: csvResponseHeaders(`apotelesmata-${suffix}`) });
}
