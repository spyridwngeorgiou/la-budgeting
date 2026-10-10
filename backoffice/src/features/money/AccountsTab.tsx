import { Amount, Badge, ButtonLink, DataTable, EmptyState, MenuLink, SectionHeader, Stat, StatRow, Toolbar, type Column, type Tone } from "@/components/ui";
import { formatDate, formatMoney } from "@/lib/format";
import { todayAthens } from "@/lib/dates";
import { el } from "@/lib/i18n/el";
import { money } from "@/lib/i18n/v2/money";
import { withParams } from "@/lib/url";
import type { AccountKind } from "@/lib/domain/enums";
import type { Params } from "./filters";
import { one, requireInternal } from "./data";
import { ACCOUNT_STATUS_ORDER, accountStatus, type AccountStatus } from "./model";
import { addAccount, checkBalance } from "./actions";
import { UrlDrawer } from "./client";
import { AccountFields, CheckFields } from "./fields";

// «Λογαριασμοί»: v_account_balances, with the latest v_balance_checks row
// (0035) as status; drifts sort first. New account / check in a drawer.

const PATH = "/money/accounts";
const t = money.accounts;
const TONE: Record<AccountStatus, Tone> = { drift: "negative", never: "warning", stale: "warning", ok: "neutral" };

export async function AccountsTab({ sp }: { sp: Params }) {
  const { supabase, orgId, canEdit } = await requireInternal();
  const today = todayAthens();
  const [{ data: accounts, error }, { data: checks }] = await Promise.all([
    supabase.from("v_account_balances").select("*").eq("org_id", orgId).order("owner_scope").order("name"),
    supabase.from("v_balance_checks").select("account_id, as_of_date, total_gap").eq("org_id", orgId).order("as_of_date", { ascending: false }),
  ]);
  if (error) throw error;

  const latest = new Map<string, { as_of_date: string; total_gap: number }>();
  for (const c of checks ?? []) {
    if (c.account_id && c.as_of_date && !latest.has(c.account_id)) latest.set(c.account_id, { as_of_date: c.as_of_date, total_gap: Number(c.total_gap) });
  }
  const rows = (accounts ?? [])
    .map((a) => {
      const check = latest.get(a.account_id!) ?? null;
      return { ...a, id: a.account_id!, check, status: accountStatus(check, today) };
    })
    .sort((a, b) => ACCOUNT_STATUS_ORDER[a.status] - ACCOUNT_STATUS_ORDER[b.status]);
  type Row = (typeof rows)[number];
  const liquid = rows.filter((a) => a.is_liquid).reduce((s, a) => s + Number(a.current_balance ?? 0), 0);

  const columns: Column<Row>[] = [
    {
      key: "name",
      header: el.account.name,
      primary: true,
      cell: (a) => (
        <span className="inline-flex flex-wrap items-center gap-1.5">
          {a.name}
          {!a.is_liquid && <Badge>{t.illiquid}</Badge>}
        </span>
      ),
    },
    { key: "kind", header: el.account.kind, cell: (a) => t.kinds[a.kind as AccountKind] ?? a.kind },
    { key: "check", header: t.lastCheck, cell: (a) => (a.check ? formatDate(a.check.as_of_date) : "—") },
    {
      key: "status",
      header: el.transaction.status,
      cell: (a) => (
        <Badge tone={TONE[a.status]}>
          {t.status[a.status]}
          {a.status === "drift" && a.check && ` · ${a.check.total_gap < 0 ? t.missingExpense : t.missingIncome} ${formatMoney(Math.abs(a.check.total_gap))}`}
        </Badge>
      ),
    },
    {
      key: "balance",
      header: el.account.currentBalance,
      numeric: true,
      cell: (a) => {
        const v = Number(a.current_balance ?? 0);
        return <Amount value={v} format={formatMoney} signed={v < 0} tone={v < 0 ? "negative" : undefined} />;
      },
    },
  ];

  const rowActions = (a: Row) => (
    <>
      <MenuLink href={withParams("/money", {}, { account_id: a.id })}>{t.transactions}</MenuLink>
      {canEdit && <MenuLink href={withParams(PATH, {}, { check: a.id })}>{t.check}</MenuLink>}
    </>
  );
  const checking = canEdit ? rows.find((a) => a.id === one(sp.check)) : undefined;

  return (
    <div className="flex flex-col gap-8">
      <Toolbar
        actions={
          canEdit && (
            <ButtonLink href={withParams(PATH, {}, { account: "new" })} size="sm">
              + {t.new}
            </ButtonLink>
          )
        }
      >
        <StatRow className="w-full border-t-0">
          <Stat label={t.liquid} value={formatMoney(liquid)} size="lg" />
        </StatRow>
      </Toolbar>

      {rows.length === 0 && <EmptyState title={t.empty} />}
      {(["corporate", "personal"] as const).map((scope) => {
        const group = rows.filter((a) => a.owner_scope === scope);
        if (group.length === 0) return null;
        return (
          <section key={scope} className="flex flex-col gap-3">
            <SectionHeader as="h3" title={el.account.ownerValues[scope]} />
            <DataTable rows={group} columns={columns} rowKey={(a) => a.id} rowActions={rowActions} />
          </section>
        );
      })}

      {canEdit && one(sp.account) === "new" && (
        <UrlDrawer title={t.new} action={addAccount} closeHref={PATH}>
          <AccountFields />
        </UrlDrawer>
      )}
      {checking && (
        <UrlDrawer title={t.check} eyebrow={checking.name} action={checkBalance.bind(null, checking.id)} closeHref={PATH}>
          <p className="text-small text-muted">{t.checkHint(formatMoney(checking.current_balance))}</p>
          <CheckFields defaultFrom={checking.check?.as_of_date ?? checking.opening_balance_date ?? todayAthens()} />
        </UrlDrawer>
      )}
    </div>
  );
}
