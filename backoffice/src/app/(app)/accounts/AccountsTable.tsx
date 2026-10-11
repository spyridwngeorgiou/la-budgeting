"use client";

import { Fragment, useState } from "react";
import { Badge } from "@/components/ui";
import { formatMoney, formatDate } from "@/lib/format";
import { BalanceAssertion, okGap, type BalanceCheck } from "./BalanceAssertion";
import { NewCheckModal } from "./NewCheckModal";

interface AccountRow {
  account_id: string;
  name: string;
  kind: string;
  is_liquid: boolean;
  opening_balance: number;
  opening_balance_date: string;
  current_balance: number;
}

type Status = "drift" | "never_counted" | "stale" | "ok";
const STALE_DAYS = 35;

function statusOf(checks: BalanceCheck[] | undefined): { status: Status; latest: BalanceCheck | null } {
  const latest = checks?.[0] ?? null;
  if (!latest) return { status: "never_counted", latest: null };
  if (!okGap(latest.total_gap)) return { status: "drift", latest };
  const days = (Date.now() - new Date(latest.as_of_date).getTime()) / 86_400_000;
  return { status: days > STALE_DAYS ? "stale" : "ok", latest };
}

// Spec-sheet cells; below md the row is a grid card and these are blocks.
const TH = "eyebrow border-b border-rule px-3 py-2.5 text-left font-medium whitespace-nowrap text-muted";
const TD = "block md:table-cell md:border-b md:border-hairline md:px-3 md:py-3 md:align-middle";

const STATUS_ORDER: Record<Status, number> = { drift: 0, never_counted: 1, stale: 2, ok: 3 };

function StatusBadge({ status, latest }: { status: Status; latest: BalanceCheck | null }) {
  if (status === "drift" && latest) {
    return (
      <Badge tone="negative">
        {latest.total_gap < 0 ? "Λείπουν έξοδα" : "Λείπουν έσοδα"} {formatMoney(Math.abs(latest.total_gap))}
      </Badge>
    );
  }
  if (status === "never_counted") return <Badge tone="warning">Χωρίς έλεγχο</Badge>;
  if (status === "stale") return <Badge tone="warning">Παλιός έλεγχος</Badge>;
  return <Badge tone="neutral">Συμφωνεί</Badge>;
}

// Comparison-first: a compact table (one row per account, worst-first
// sorted) with the detailed period breakdown folded into an expandable row,
// instead of every account as an independent tall card -- the original
// layout made it impossible to see at a glance which accounts needed
// attention without opening each one.
export function AccountsTable({
  accounts,
  checksByAccount,
}: {
  accounts: AccountRow[];
  checksByAccount: Map<string, BalanceCheck[]>;
}) {
  const rows = accounts
    .map((a) => {
      const checks = checksByAccount.get(a.account_id) ?? [];
      const { status, latest } = statusOf(checks);
      return { account: a, checks, status, latest };
    })
    .sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]);

  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(rows.filter((r) => r.status === "drift" || r.status === "never_counted").map((r) => r.account.account_id)),
  );
  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  return (
    // One list, laid out by CSS: a spec-sheet table from md up, hairline
    // cards on a phone (the row is a grid, the cells are blocks in it).
    <table className="block w-full border-collapse text-left text-sm md:table">
      <thead className="hidden md:table-header-group">
        <tr>
          <th scope="col" className={TH}>Λογαριασμός</th>
          <th scope="col" className={`${TH} text-right`}>Τρέχον Υπόλοιπο</th>
          <th scope="col" className={TH}>Τελευταίος Έλεγχος</th>
          <th scope="col" className={TH}>Κατάσταση</th>
          <th scope="col" className={TH}></th>
        </tr>
      </thead>
      <tbody className="block border-t border-rule md:table-row-group md:border-t-0">
        {rows.map(({ account: a, checks, status, latest }) => {
          const isOpen = expanded.has(a.account_id);
          const drift = status === "drift";
          return (
            <Fragment key={a.account_id}>
              <tr
                onClick={() => toggle(a.account_id)}
                aria-expanded={isOpen}
                className={`grid min-h-11 cursor-pointer grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1 border-b border-hairline py-3 hover:bg-hover md:table-row md:border-b-0 md:py-0 ${
                  drift ? "border-l-2 border-l-negative pl-3 md:border-l-0 md:pl-0" : ""
                }`}
              >
                <td className={`${TD} col-start-1 row-start-1 min-w-0 ${drift ? "md:border-l-2 md:border-l-negative" : ""}`}>
                  <span className="text-ink">{a.name}</span>
                  {!a.is_liquid && (
                    <span className="ml-2">
                      <Badge tone="neutral">μη ρευστό</Badge>
                    </span>
                  )}
                </td>
                <td className={`${TD} num col-start-2 row-start-1 text-right text-body text-ink md:text-sm`}>
                  {formatMoney(a.current_balance)}
                </td>
                <td className={`${TD} col-start-1 row-start-2 text-small text-muted md:text-sm`}>
                  <span className="md:hidden">Τελευταίος Έλεγχος · </span>
                  <span className="num">{latest ? formatDate(latest.as_of_date) : "—"}</span>
                </td>
                <td className={`${TD} col-start-1 row-start-3`}>
                  <StatusBadge status={status} latest={latest} />
                </td>
                <td
                  aria-hidden="true"
                  className={`${TD} col-start-2 row-span-2 row-start-2 self-center text-right text-muted`}
                >
                  {isOpen ? "▲" : "▼"}
                </td>
              </tr>
              {isOpen && (
                <tr className="block border-b border-hairline md:table-row">
                  <td colSpan={5} className="block pt-1 pb-5 md:table-cell md:border-b md:border-hairline md:px-3 md:pt-2">
                    <div className="flex flex-col gap-3">
                      <div className="text-small text-muted">
                        Έναρξη {formatDate(a.opening_balance_date)}: <span className="num">{formatMoney(a.opening_balance)}</span>
                      </div>
                      <BalanceAssertion accountId={a.account_id} checks={checks} isCash={a.kind === "cash"} />
                      <div>
                        <NewCheckModal
                          accountId={a.account_id}
                          expectedToday={Number(a.current_balance ?? 0)}
                          defaultFrom={checks[0]?.as_of_date ?? a.opening_balance_date}
                          hasChecks={checks.length > 0}
                        />
                      </div>
                    </div>
                  </td>
                </tr>
              )}
            </Fragment>
          );
        })}
      </tbody>
    </table>
  );
}
