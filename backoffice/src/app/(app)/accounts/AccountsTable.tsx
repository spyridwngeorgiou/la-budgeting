import Link from "next/link";
import { LINK_CLASS, SUB_CLASS, SpecTable, StatusDot, Td, Th, Tr, cn } from "@/components/ui";
import { formatDate, formatMoney } from "@/lib/format";
import { el } from "@/lib/i18n/el";
import { shell } from "@/lib/i18n/v2/shell";
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

// Below lg each row is a card (CSS grid), from lg up a spec-table row.
const CELL = "block max-lg:border-b-0 max-lg:p-0 lg:table-cell";

// The accounts as one spec table with column heads, grouped by owner
// (Εταιρικοί / Προσωπικοί): the name (the link to the account's «Ανάλυση
// κινήσεων»), type and owner, the balance (true minus, red only when
// negative), the last check, then the two row actions in sight -- «Νέος
// έλεγχος» and «Επεξεργασία». Server-rendered; the two client buttons get
// plain props (ids and values), no bound actions.
export function AccountsTable({
  groups,
  today,
}: {
  groups: { scope: "corporate" | "personal"; rows: AccountListRow[] }[];
  today: string;
}) {
  return (
    <SpecTable label={el.nav.accounts} tableClassName="block lg:table">
      <thead className="hidden lg:table-header-group">
        <tr>
          <Th>{el.account.name}</Th>
          <Th>{el.account.kindOwner}</Th>
          <Th numeric>{el.account.runningBalance}</Th>
          <Th>{el.account.lastCheck}</Th>
          <Th>
            <span className="sr-only">{shell.ui.actions}</span>
          </Th>
        </tr>
      </thead>
      {groups.map((group) => (
        <tbody key={group.scope} className="block lg:table-row-group">
          <tr className="block lg:table-row">
            <th
              scope="rowgroup"
              colSpan={5}
              className="eyebrow block border-b border-hairline pt-5 pb-2 text-left font-medium text-muted lg:table-cell"
            >
              {el.account.groups[group.scope]}
            </th>
          </tr>
          {group.rows.map((a) => {
            const kindOwner = `${el.account.kindValues[a.kind]} · ${el.account.ownerValues[a.form.owner_scope]}`;
            const stale = !!a.last_check && isStale(a.last_check, today);
            return (
              <Tr
                key={a.account_id}
                className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1.5 border-b border-hairline py-3 lg:table-row lg:border-b-0 lg:py-0 lg:[&>td]:align-middle"
              >
                <Td className={cn(CELL, "col-start-1 row-start-1 min-w-0 lg:min-w-48")}>
                  <Link href={`/accounts/${a.account_id}`} className={cn(LINK_CLASS, "text-body break-words")}>
                    {a.name}
                  </Link>
                  <span className={cn(SUB_CLASS, "lg:hidden")}>
                    {kindOwner}
                    {!a.is_liquid && ` · ${el.account.illiquid}`}
                  </span>
                </Td>
                <Td className="hidden lg:table-cell">
                  {kindOwner}
                  {!a.is_liquid && <span className={SUB_CLASS}>{el.account.illiquid}</span>}
                </Td>
                <Td numeric className={cn(CELL, "col-start-2 row-start-1", a.current_balance < 0 ? "text-negative" : "text-ink")}>
                  {formatMoney(a.current_balance)}
                </Td>
                <Td className={cn(CELL, "col-span-2 col-start-1 row-start-2")}>
                  <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <StatusDot tone={STATUS_TONE[a.status]} label={STATUS_LABEL[a.status]} />
                    <span className={cn("num text-small", stale ? "text-warning" : "text-muted")}>
                      <span className="lg:hidden">{el.account.lastCheck} </span>
                      {a.last_check ? formatDate(a.last_check) : "—"}
                    </span>
                  </span>
                </Td>
                <Td className={cn(CELL, "col-span-2 col-start-1 row-start-3 lg:py-1.5")}>
                  <span className="flex flex-wrap items-center gap-1 lg:justify-end">
                    <CheckDrawer
                      accountId={a.account_id}
                      accountName={a.name}
                      expectedToday={a.current_balance}
                      defaultFrom={a.check_from}
                      historyLink
                      variant="ghost"
                      size="sm"
                    />
                    <AccountFormModal account={a.form} />
                  </span>
                </Td>
              </Tr>
            );
          })}
        </tbody>
      ))}
    </SpecTable>
  );
}
