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

const STATUS_ORDER: Record<Status, number> = { drift: 0, never_counted: 1, stale: 2, ok: 3 };

function StatusBadge({ status, latest }: { status: Status; latest: BalanceCheck | null }) {
  if (status === "drift" && latest) {
    return (
      <Badge tone="red">
        {latest.total_gap < 0 ? "Λείπουν έξοδα" : "Λείπουν έσοδα"} {formatMoney(Math.abs(latest.total_gap))}
      </Badge>
    );
  }
  if (status === "never_counted") return <Badge tone="amber">Χωρίς έλεγχο</Badge>;
  if (status === "stale") return <Badge tone="amber">Παλιός έλεγχος</Badge>;
  return <Badge tone="green">Συμφωνεί</Badge>;
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
    <div className="overflow-x-auto rounded-lg border border-line">
      <table className="min-w-full text-sm">
        <thead>
          <tr className="border-b border-line bg-bg text-left text-ink-muted">
            <th className="p-3 font-medium">Λογαριασμός</th>
            <th className="p-3 text-right font-medium">Τρέχον Υπόλοιπο</th>
            <th className="p-3 font-medium">Τελευταίος Έλεγχος</th>
            <th className="p-3 font-medium">Κατάσταση</th>
            <th className="p-3"></th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ account: a, checks, status, latest }) => {
            const isOpen = expanded.has(a.account_id);
            return (
              <Fragment key={a.account_id}>
                <tr
                  onClick={() => toggle(a.account_id)}
                  className="cursor-pointer border-b border-line last:border-0 hover:bg-bg/60"
                >
                  <td className="p-3">
                    <span className="font-medium text-ink">{a.name}</span>
                    {!a.is_liquid && (
                      <span className="ml-2">
                        <Badge tone="amber">μη ρευστό</Badge>
                      </span>
                    )}
                  </td>
                  <td className="p-3 text-right font-mono font-semibold tabular-nums text-ink">{formatMoney(a.current_balance)}</td>
                  <td className="p-3 text-ink-muted">{latest ? formatDate(latest.as_of_date) : "—"}</td>
                  <td className="p-3">
                    <StatusBadge status={status} latest={latest} />
                  </td>
                  <td className="p-3 text-right text-ink-faint">{isOpen ? "▲" : "▼"}</td>
                </tr>
                {isOpen && (
                  <tr className="border-b border-line bg-bg/40 last:border-0">
                    <td colSpan={5} className="p-3">
                      <div className="flex flex-col gap-3">
                        <div className="text-xs text-ink-faint">
                          Έναρξη {formatDate(a.opening_balance_date)}: {formatMoney(a.opening_balance)}
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
    </div>
  );
}
