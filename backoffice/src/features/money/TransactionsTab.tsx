import Form from "next/form";
import { AiSpark, Amount, Badge, Button, ButtonLink, DataTable, EmptyState, Field, FilterChip, Input, MenuLink, MenuSeparator, MetaList, Select, Toolbar, type Column } from "@/components/ui";
import { formatDate, formatMoney } from "@/lib/format";
import type { Tables } from "@/lib/db/types";
import { todayAthens } from "@/lib/dates";
import { el } from "@/lib/i18n/el";
import { money } from "@/lib/i18n/v2/money";
import { withParams } from "@/lib/url";
import { chipHref, filterParams, hasFilters, isViewActive, parseTxFilters, SAVED_VIEWS, viewHref, type Params, type SavedView } from "./filters";
import { isOverdue, onScreenTotals, signedAmount } from "./model";
import { loadOptions, one, requireInternal, type Options } from "./data";
import { markTransactionPaid, removeTransaction } from "./actions";
import { RowAction, SourceDocumentItem } from "./client";
import { PayDrawer, TxDrawer } from "./TxDrawer";

// «Κινήσεις»: the ledger with its filters in the URL. Saved views and
// chips are withParams() links, so no filter resets another; the detailed
// filters are one GET form. Rows read first; «⋯» edits in a drawer.

const ROW_LIMIT = 500;
const PATH = "/money";
const AI_ORIGINS = new Set(["ai_document", "ai_nl", "ai_email"]);
const t = money.tx;
const SELECT =
  "id, tx_date, due_date, paid_on, plan_id, installment_no, property_project_id, description, direction, status, scope, gross_amount, net_amount, vat_rate, withholding_amount, has_invoice, invoice_number, contact_id, project_id, category_id, account_id, origin, source_document_id, contacts(name), projects(display_name), categories(name)";

const name = (rel: unknown, key: string): string | null => {
  const r = Array.isArray(rel) ? rel[0] : rel;
  return r && typeof r === "object" ? ((r as Record<string, string | null>)[key] ?? null) : null;
};

export async function TransactionsTab({ sp }: { sp: Params }) {
  const { supabase, orgId, canEdit } = await requireInternal();
  const f = parseTxFilters(sp);
  const today = todayAthens();
  const kept = filterParams(sp);
  const closeHref = withParams(PATH, kept);
  const editId = one(sp.edit);
  const payId = one(sp.pay);

  let query = supabase.from("transactions").select(SELECT, { count: "exact" }).eq("org_id", orgId);
  if (f.status) query = query.eq("status", f.status);
  if (f.direction) query = query.eq("direction", f.direction);
  if (f.project_id) query = query.eq("project_id", f.project_id);
  if (f.account_id) query = query.eq("account_id", f.account_id);
  if (f.contact_id) query = query.eq("contact_id", f.contact_id);
  if (f.category_id) query = query.eq("category_id", f.category_id);
  if (f.scope) query = query.eq("scope", f.scope);
  if (f.from) query = query.gte("tx_date", f.from);
  if (f.to) query = query.lte("tx_date", f.to);
  if (f.ids) query = query.in("id", f.ids);
  if (f.overdue) query = query.in("status", ["pending", "scheduled"]).lt("due_date", today);
  if (f.plan === "any") query = query.not("plan_id", "is", null);
  else if (f.plan) query = query.eq("plan_id", f.plan);
  if (f.q) query = query.or(`description.ilike."*${f.q}*",invoice_number.ilike."*${f.q}*"`);

  const byId = (id: string | null) =>
    id ? supabase.from("transactions").select(SELECT).eq("org_id", orgId).eq("id", id).maybeSingle() : Promise.resolve({ data: null });

  const [{ data, count, error }, options, plans, balance, { data: editing }, { data: paying }] = await Promise.all([
    query.order("tx_date", { ascending: false }).limit(ROW_LIMIT),
    loadOptions(supabase, orgId),
    f.plan
      ? supabase.from("v_plan_progress").select("*").eq("org_id", orgId).then((r) => r.data ?? [])
      : Promise.resolve([]),
    f.account_id
      ? supabase.from("v_account_balances").select("*").eq("org_id", orgId).eq("account_id", f.account_id).maybeSingle().then((r) => r.data)
      : Promise.resolve(null),
    canEdit ? byId(editId) : Promise.resolve({ data: null }),
    canEdit ? byId(payId) : Promise.resolve({ data: null }),
  ]);
  if (error) throw error;

  const rows = (data ?? []).map((r) => ({
    ...r,
    contact_name: name(r.contacts, "name"),
    project_name: name(r.projects, "display_name"),
    category_name: name(r.categories, "name"),
  }));
  type Row = (typeof rows)[number];
  const totals = onScreenTotals(rows);
  const shown = (v: number) => <Amount value={v} format={formatMoney} />;

  const columns: Column<Row>[] = [
    { key: "date", header: el.transaction.date, cell: (r) => formatDate(r.tx_date), className: "whitespace-nowrap" },
    {
      key: "what",
      header: t.what,
      primary: true,
      cell: (r) => (
        <span className="flex flex-col">
          <span className="inline-flex items-center gap-1.5">
            {r.contact_name ?? r.description ?? "—"}
            {AI_ORIGINS.has(r.origin ?? "") && <AiSpark className="text-ai" />}
          </span>
          {r.contact_name && r.description && <span className="text-small text-muted">{r.description}</span>}
        </span>
      ),
    },
    { key: "project", header: el.transaction.project, cell: (r) => r.project_name ?? "—" },
    { key: "category", header: el.transaction.category, cell: (r) => r.category_name ?? "—", hideOnCard: true },
    {
      key: "status",
      header: el.transaction.status,
      cell: (r) => (
        <span className="inline-flex flex-wrap gap-1">
          <Badge>{el.transaction[r.status as keyof typeof el.transaction]}</Badge>
          {isOverdue(r, today) && <Badge tone="negative">{t.overdue}</Badge>}
          {r.plan_id && <Badge>{t.instalment(r.installment_no)}</Badge>}
        </span>
      ),
    },
    { key: "amount", header: t.amount, numeric: true, cell: (r) => shown(signedAmount(r.direction, r.gross_amount)) },
  ];

  const rowActions = canEdit
    ? (r: Row) => (
        <>
          <MenuLink href={withParams(PATH, kept, { edit: r.id })}>{el.common.edit}</MenuLink>
          {r.status !== "paid" && <RowAction action={markTransactionPaid} args={[r.id]}>{el.common.markPaid}</RowAction>}
          {(r.status === "pending" || r.status === "scheduled") && !r.plan_id && (
            <MenuLink href={withParams(PATH, kept, { pay: r.id })}>{t.payPart}</MenuLink>
          )}
          {r.source_document_id && <SourceDocumentItem transactionId={r.id} />}
          <MenuSeparator />
          <RowAction action={removeTransaction} args={[r.id]} confirm={t.deleteConfirm} tone="danger">
            {el.common.delete}
          </RowAction>
        </>
      )
    : undefined;

  const exportHref = withParams("/api/transactions/export", kept);
  return (
    <div className="flex flex-col gap-6">
      <Toolbar
        label={t.saved}
        actions={
          <>
            <ButtonLink href={exportHref} variant="secondary" size="sm">
              {t.export}
            </ButtonLink>
            {canEdit && (
              <ButtonLink href={withParams(PATH, kept, { new: "1" })} size="sm">
                + {t.new}
              </ButtonLink>
            )}
          </>
        }
      >
        {(Object.keys(SAVED_VIEWS) as SavedView[]).map((v) => (
          <FilterChip key={v} href={viewHref(PATH, sp, v)} active={isViewActive(sp, v)}>
            {t.views[v]}
          </FilterChip>
        ))}
      </Toolbar>

      <Toolbar label={t.filters}>
        {([null, "paid", "pending", "scheduled"] as const).map((s) => (
          <FilterChip key={s ?? "all"} href={chipHref(PATH, sp, "status", s)} active={f.status === s}>
            {s ? t.status[s] : t.all}
          </FilterChip>
        ))}
        <span aria-hidden="true" className="mx-1 h-6 border-l border-hairline" />
        {([null, "income", "expense"] as const).map((d) => (
          <FilterChip key={d ?? "both"} href={chipHref(PATH, sp, "direction", d)} active={f.direction === d}>
            {d ? t[d] : t.allDirections}
          </FilterChip>
        ))}
      </Toolbar>

      <FilterForm sp={sp} options={options} />

      {(balance || f.ids || (count ?? 0) > ROW_LIMIT) && (
        <div className="flex flex-col gap-1 border-l-2 border-warning pl-3 text-small text-text">
          {balance && (
            <p>
              {t.accountBalance(formatMoney(balance.opening_balance), formatDate(balance.opening_balance_date), formatMoney(balance.current_balance))}
            </p>
          )}
          {f.ids && <p>{t.fromAi}</p>}
          {(count ?? 0) > ROW_LIMIT && <p>{t.truncated(ROW_LIMIT, count ?? 0)}</p>}
        </div>
      )}

      {f.plan && <Plans plans={plans} sp={sp} />}

      {rows.length === 0 ? (
        <EmptyState
          title={t.empty}
          body={t.emptyBody}
          action={hasFilters(sp) && <ButtonLink href={PATH} variant="secondary" size="sm">{t.clear}</ButtonLink>}
        />
      ) : (
        <div className="flex flex-col gap-2">
          <MetaList
            items={[t.count(rows.length), <>{t.income} {shown(totals.income)}</>, <>{t.expense} {shown(-totals.expense)}</>]}
          />
          <DataTable rows={rows} columns={columns} rowKey={(r) => r.id} rowActions={rowActions} totals={{ amount: shown(totals.net) }} />
        </div>
      )}

      {canEdit && one(sp.new) === "1" && <TxDrawer id={null} options={options} closeHref={closeHref} />}
      {editing && <TxDrawer key={editing.id} id={editing.id} initial={editing} options={options} closeHref={closeHref} />}
      {paying && (
        <PayDrawer
          key={paying.id}
          id={paying.id}
          label={paying.description ?? name(paying.contacts, "name") ?? formatDate(paying.tx_date)}
          remaining={Number(paying.gross_amount ?? 0)}
          accountId={paying.account_id}
          accounts={options.accounts}
          closeHref={closeHref}
        />
      )}
    </div>
  );
}

// The detailed filters: one GET form. The chip filters ride along as
// hidden fields, so applying the form keeps them.
function FilterForm({ sp, options }: { sp: Params; options: Options }) {
  const kept = filterParams(sp);
  const hidden = ["status", "direction", "scope", "overdue", "plan", "ids"] as const;
  const pick = (key: string, label: string, items: { id: string; label: string }[]) => (
    <Field label={label}>
      <Select name={key} defaultValue={kept[key] ?? ""}>
        <option value="">{t.any}</option>
        {items.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </Select>
    </Field>
  );
  return (
    <Form action={PATH} className="grid gap-3 border-y border-hairline py-4 sm:grid-cols-2 lg:grid-cols-4">
      {hidden.map((k) => kept[k] && <input key={k} type="hidden" name={k} value={kept[k]} />)}
      <Field label={el.common.search} className="sm:col-span-2">
        <Input type="search" name="q" defaultValue={kept.q ?? ""} placeholder={t.search} />
      </Field>
      <div className="grid grid-cols-2 gap-3 sm:col-span-2">
        <Field label={t.from}>
          <Input type="date" name="from" defaultValue={kept.from ?? ""} />
        </Field>
        <Field label={t.to}>
          <Input type="date" name="to" defaultValue={kept.to ?? ""} />
        </Field>
      </div>
      {pick("project_id", el.transaction.project, options.projects)}
      {pick("account_id", el.transaction.account, options.accounts)}
      {pick("category_id", el.transaction.category, options.categories)}
      {pick("contact_id", el.transaction.contact, options.contacts)}
      <div className="flex flex-wrap items-center gap-2 sm:col-span-2 lg:col-span-4">
        <Button type="submit" variant="secondary" size="sm">
          {t.apply}
        </Button>
        {hasFilters(sp) && (
          <ButtonLink href={PATH} variant="ghost" size="sm">
            {t.clear}
          </ButtonLink>
        )}
      </div>
    </Form>
  );
}

type PlanRow = Tables<"v_plan_progress">;

// Δόσεις as a filter: the plans, each one a link narrowing the list to it.
function Plans({ plans, sp }: { plans: PlanRow[]; sp: Params }) {
  const columns: Column<PlanRow>[] = [
    { key: "label", header: t.plans, primary: true, cell: (p) => p.label ?? "—" },
    { key: "paid", header: t.planPaid, numeric: true, cell: (p) => `${p.paid_count ?? 0} / ${p.installments_total ?? 0}` },
    { key: "remaining", header: t.remaining, numeric: true, cell: (p) => formatMoney(p.remaining_amount) },
    {
      key: "next",
      header: t.nextDue,
      cell: (p) => (
        <span className="inline-flex gap-1.5">
          {p.next_due_date ? formatDate(p.next_due_date) : "—"}
          {!!p.overdue_count && <Badge tone="negative">{p.overdue_count} {t.overdue}</Badge>}
        </span>
      ),
    },
  ];
  return (
    <DataTable
      rows={plans}
      columns={columns}
      rowKey={(p) => p.plan_id ?? ""}
      rowHref={(p) => chipHref(PATH, sp, "plan", p.plan_id)}
      empty={t.noPlans}
    />
  );
}
