import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { toCsv, csvResponseHeaders } from "@/lib/csv";
import { netWorthCsv } from "@/lib/finance/reportCsv";
import { reportExportOrg } from "../../auth";

// «Εξαγωγή CSV» of /reports/net-worth: v_net_worth's components and the
// v_net_worth_items the page lists under them (receivables and payables are
// open ledger rows -- the transactions export has those).
const COMPONENTS = ["cash", "other_accounts", "assets", "receivables", "payables", "liabilities", "loans", "vat"] as const;

export async function GET() {
  const org = await reportExportOrg();
  if (org instanceof NextResponse) return org;

  const supabase = await createClient();
  const [{ data: total, error }, { data: items }] = await Promise.all([
    supabase.from("v_net_worth").select("*").eq("org_id", org.orgId).maybeSingle(),
    supabase
      .from("v_net_worth_items")
      .select("component, owner_scope, label, amount")
      .eq("org_id", org.orgId)
      .in("component", ["other_accounts", "assets", "liabilities", "loans"])
      .neq("amount", 0)
      .order("amount", { ascending: false }),
  ]);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Same signs as the page: what we owe is negative.
  const amountOf: Record<string, number> = {
    cash: Number(total?.cash_total ?? 0),
    other_accounts: Number(total?.other_accounts_total ?? 0),
    assets: Number(total?.asset_total ?? 0),
    receivables: Number(total?.receivables_total ?? 0),
    payables: -Number(total?.payables_total ?? 0),
    liabilities: -Number(total?.liability_total ?? 0),
    loans: -Number(total?.loans_total ?? 0),
    vat: Number(total?.vat_total ?? 0),
  };
  const { header, rows } = netWorthCsv(COMPONENTS, amountOf, items ?? [], Number(total?.net_worth ?? 0));
  return new NextResponse(toCsv(header, rows), { headers: csvResponseHeaders("kathari-thesi") });
}
