"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { reliability, reliabilityText, reportKeyOf, type WorklistRow } from "@/lib/finance/insights";

// «Επηρεάζεται από N θέματα →» under the report tabs: the open quality
// checks (v_worklist) that touch the current tab's figures. The reports
// layout reads v_worklist once for the whole section (a layout is not
// re-rendered when switching tabs), so no tab pays an extra query for it;
// this picks the tab's checks by its path. Plain rows in, no functions.
export function ReliabilityLine({ rows }: { rows: WorklistRow[] }) {
  const key = reportKeyOf(usePathname() ?? "");
  const r = key ? reliability(rows, key) : null;
  if (!r) return null;
  return (
    <Link
      href={r.href}
      className="inline-flex min-w-0 items-center border-l-2 border-warning pl-3 text-small text-text underline-offset-4 hover:underline max-md:min-h-11"
    >
      {reliabilityText(r.count)}
    </Link>
  );
}
