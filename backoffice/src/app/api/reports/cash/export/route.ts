import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { toCsv, csvResponseHeaders } from "@/lib/csv";
import { parseHorizon, parseScenario, parseScope } from "@/lib/finance/forecastParams";
import { cashCsv } from "@/lib/finance/reportCsv";
import { reportExportOrg } from "../../auth";

// «Εξαγωγή CSV» of /reports/cash: cash_forecast() with the page's
// parameters (scenario, scope, months), one row per month.
export async function GET(request: NextRequest) {
  const org = await reportExportOrg();
  if (org instanceof NextResponse) return org;

  const params = request.nextUrl.searchParams;
  const scenario = parseScenario(params.get("scenario") ?? undefined);
  const scope = parseScope(params.get("scope") ?? undefined);
  const months = parseHorizon(params.get("months") ?? undefined, 12);

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("cash_forecast", {
    p_org: org.orgId,
    p_months: months,
    p_scenario: scenario,
    p_scope: scope ?? undefined,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const { header, rows } = cashCsv(data ?? []);
  const suffix = [scenario, scope, `${months}m`].filter(Boolean).join("-");
  return new NextResponse(toCsv(header, rows), { headers: csvResponseHeaders(`tameio-${suffix}`) });
}
