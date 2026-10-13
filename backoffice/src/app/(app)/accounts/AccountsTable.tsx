import Link from "next/link";
import { StatusDot, cn } from "@/components/ui";
import { formatDate, formatMoney } from "@/lib/format";
import { el } from "@/lib/i18n/el";
import type { AccountKind } from "@/lib/domain/enums";
import { STATUS_LABEL, STATUS_TONE, isStale, type AccountStatus } from "./status";
import { AccountFormModal, type AccountFormValues } from "./AccountFormModal";
import { CheckDrawer } from "./CheckDrawer";

export interface AccountListRow {
  account_id: string;
  name: string;
  kind: AccountKind;
  is_liquid: boolean;
  current_balance: number;
  status: AccountStatus;
  last_check: string | null;
  // Where a new check starts: the last check, else the opening date.
  check_from: string;
  // The edit form's values.
  form: AccountFormValues;
}

// One row per account, as on 7/10: name and kind on the left (the link to
// the account's «ανάλυση κινήσεων»), the signed balance with the last
// check under it, then the two row actions in sight -- «Νέος έλεγχος» and
// «Επεξεργασία». Server-rendered; the two client buttons get plain props
// (ids and values), no bound actions.
export function AccountsTable({ accounts, today }: { accounts: AccountListRow[]; today: string }) {
  return (
    <ul className="flex flex-col border-t border-rule">
      {accounts.map((a) => (
        <li
          key={a.account_id}
          className="flex flex-wrap items-center justify-end gap-x-4 gap-y-1 border-b border-hairline py-2 md:flex-nowrap md:px-3"
        >
          <Link
            href={`/accounts/${a.account_id}`}
            className="flex min-h-14 min-w-0 flex-1 basis-full items-center justify-between gap-4 py-2 hover:bg-hover md:basis-auto"
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
                <span className={cn("num", a.last_check && isStale(a.last_check, today) && "text-warning")}>
                  {a.last_check ? `${el.account.lastCheck} ${formatDate(a.last_check)}` : "—"}
                </span>
              </span>
            </span>
          </Link>
          <span className="flex shrink-0 items-center gap-1">
            <CheckDrawer
              accountId={a.account_id}
              accountName={a.name}
              isCash={a.kind === "cash"}
              expectedToday={a.current_balance}
              defaultFrom={a.check_from}
              label={el.account.newCheck}
              variant="ghost"
              size="sm"
            />
            <AccountFormModal account={a.form} />
          </span>
        </li>
      ))}
    </ul>
  );
}
