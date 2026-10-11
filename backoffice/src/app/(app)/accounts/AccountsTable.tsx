import Link from "next/link";
import { StatusDot, cn } from "@/components/ui";
import { formatDate, formatMoney } from "@/lib/format";
import { el } from "@/lib/i18n/el";
import type { AccountKind } from "@/lib/domain/enums";
import { STATUS_LABEL, STATUS_TONE, isStale, type AccountStatus } from "./status";

export interface AccountListRow {
  account_id: string;
  name: string;
  kind: AccountKind;
  is_liquid: boolean;
  current_balance: number;
  status: AccountStatus;
  last_check: string | null;
}

// A clean list, not a grid: one row per account -- name and kind on the
// left, the signed balance large on the right, the check status as a small
// dot under it. The whole row opens the account's «ανάλυση κινήσεων».
// Server-rendered, no client state, no per-row actions.
export function AccountsTable({ accounts, today }: { accounts: AccountListRow[]; today: string }) {
  return (
    <ul className="flex flex-col border-t border-rule">
      {accounts.map((a) => (
        <li key={a.account_id} className="border-b border-hairline">
          <Link
            href={`/accounts/${a.account_id}`}
            className="flex min-h-16 items-center justify-between gap-4 py-4 hover:bg-hover md:px-3"
          >
            <span className="flex min-w-0 flex-col gap-1">
              <span className="truncate text-body text-ink">{a.name}</span>
              <span className="text-small text-muted">
                {el.account.kindValues[a.kind]}
                {!a.is_liquid && ` · ${el.account.illiquid}`}
              </span>
            </span>
            <span className="flex shrink-0 flex-col items-end gap-1">
              <span className={cn("num text-figure-sm font-light", a.current_balance < 0 ? "text-negative" : "text-ink")}>
                {a.current_balance < 0 ? "−" : ""}
                {formatMoney(Math.abs(a.current_balance))}
              </span>
              <span className="flex items-center gap-3 text-small text-muted">
                <StatusDot tone={STATUS_TONE[a.status]} label={STATUS_LABEL[a.status]} />
                {a.last_check && (
                  <span className={cn("num", isStale(a.last_check, today) && "text-warning")}>
                    {formatDate(a.last_check)}
                  </span>
                )}
              </span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
