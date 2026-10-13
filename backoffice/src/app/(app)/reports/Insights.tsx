import Link from "next/link";
import type { ReactNode } from "react";
import { LINK_CLASS } from "@/components/ui";
import type { createClient } from "@/lib/supabase/server";
import { RELIABILITY_CODES, reliability, type ReportKey } from "@/lib/finance/insights";

// The small shared pieces of the report tabs. Server components; the
// figures come from lib/finance/insights (pure, tested).

// A KPI figure that opens the rows behind it.
export function KpiLink({ href, children }: { href: string | null | undefined; children: ReactNode }) {
  if (!href) return <>{children}</>;
  return (
    <Link href={href} className={LINK_CLASS}>
      {children}
    </Link>
  );
}

// «Διαχείριση →» beside a read-only list: the list is managed elsewhere.
export function ManageLink({ href }: { href: string }) {
  return (
    <Link href={href} className="inline-flex items-center text-small text-ink underline underline-offset-4 max-md:min-h-11">
      Διαχείριση →
    </Link>
  );
}

type Supabase = Awaited<ReturnType<typeof createClient>>;

// The open quality checks (v_worklist) that touch one report's figures,
// for the footer's «N θέματα ποιότητας →»; null when there are none. One
// small query, run beside the tab's own.
export async function reportIssues(supabase: Supabase, orgId: string, key: ReportKey) {
  const { data } = await supabase
    .from("v_worklist")
    .select("code, count, href")
    .eq("org_id", orgId)
    .in("code", [...RELIABILITY_CODES[key]]);
  return reliability(data ?? [], key);
}
