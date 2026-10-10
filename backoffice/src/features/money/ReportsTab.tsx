import Link from "next/link";
import { Amount, Badge, ButtonLink, DataTable, KeyValue, MenuLink, MenuSeparator, SectionHeader, Segmented, Stat, Toolbar, type Column } from "@/components/ui";
import { formatDate, formatMoney } from "@/lib/format";
import { addMonths, currentMonthKey, currentYear, firstOfMonth, monthKeyOf, quarterOf, shortMonthLabel } from "@/lib/dates";
import { el } from "@/lib/i18n/el";
import { money } from "@/lib/i18n/v2/money";
import { withParams } from "@/lib/url";
import { BUSINESS_LINES, pnlTable, type PnlGroup, type PnlTableRow } from "@/lib/finance/pnl";
import type { Params } from "./filters";
import { one, requireInternal } from "./data";
import { parseReportView, REPORT_VIEWS } from "./tabs";
import { visiblePnlRows } from "./model";
import { removeAsset, removeLiability, saveAsset, saveLiability, toggleVatFiled } from "./actions";
import { RowAction, UrlDrawer } from "./client";
import { AssetFields, LiabilityFields } from "./fields";

// «Αναφορές», three views (?view=): Αποτελέσματα (pnl_summary, 0067),
// Φόροι (v_vat_position + v_withholding_position) and Περιουσία (v_net_worth,
// 0068, and the hand-kept assets / liabilities). Every figure is SQL; this
// only lays rows out.

const PATH = "/money/reports";
const t = money.reports;
const r = el.reports;
const signed = (v: number) => (v === 0 ? "—" : <Amount value={v} format={formatMoney} />);
type Supabase = Awaited<ReturnType<typeof requireInternal>>["supabase"];

export async function ReportsTab({ sp }: { sp: Params }) {
  const ctx = await requireInternal();
  const view = parseReportView(sp.view);
  return (
    <div className="flex flex-col gap-8">
      <Segmented
        label={t.views}
        active={view}
        options={REPORT_VIEWS.map((v) => ({ key: v, label: t[v], href: withParams(PATH, {}, { view: v === "pnl" ? null : v }) }))}
      />
      {view === "pnl" && <Pnl {...ctx} sp={sp} />}
      {view === "taxes" && <Taxes {...ctx} />}
      {view === "assets" && <Assets {...ctx} sp={sp} />}
    </div>
  );
}

async function Pnl({ supabase, orgId, sp }: { supabase: Supabase; orgId: string; sp: Params }) {
  const thisYear = currentYear();
  const y = Number(one(sp.year));
  const year = Number.isInteger(y) && y >= 2000 && y <= thisYear + 5 ? y : thisYear;
  const group: PnlGroup = one(sp.by) === "line" ? "business_line" : "month";
  const scheduled = one(sp.scheduled) === "1";
  const kept = { year: one(sp.year), by: one(sp.by), scheduled: one(sp.scheduled) };
  const here = (changes: Record<string, string | null>) => withParams(PATH, kept, changes);

  const { data, error } = await supabase.rpc("pnl_summary", {
    p_org: orgId,
    p_from: `${year}-01-01`,
    p_to: `${year}-12-31`,
    p_group: group,
    p_include_scheduled: scheduled,
  });
  if (error) throw error;
  const buckets =
    group === "month"
      ? Array.from({ length: 12 }, (_, i) => addMonths(`${year}-01`, i))
      : BUSINESS_LINES.filter((b) => (data ?? []).some((x) => x.bucket === b));
  const rows = visiblePnlRows(pnlTable(data ?? [], buckets).rows);
  const isSum = (row: PnlTableRow) => row.line === "gross_profit" || row.line === "result";
  const strong = (row: PnlTableRow, node: React.ReactNode) => (isSum(row) ? <span className="font-medium text-ink">{node}</span> : node);
  const label = (b: string) => (group === "month" ? shortMonthLabel(b) : (r.businessLines[b as keyof typeof r.businessLines] ?? b));

  const columns: Column<PnlTableRow>[] = [
    {
      key: "line",
      header: "",
      cell: (row) => strong(row, <span className="whitespace-nowrap">{r.lines[row.line]}</span>),
    },
    ...buckets.map((b, i) => ({
      key: b,
      header: label(b),
      numeric: true,
      cell: (row: PnlTableRow) => strong(row, signed(row.values[i])),
    })),
    { key: "total", header: r.total, numeric: true, cell: (row) => strong(row, signed(row.total)) },
  ];
  const years = [thisYear - 2, thisYear - 1, thisYear, thisYear + 1];
  const unclassified = rows.some((x) => x.line === "unclassified");

  return (
    <section className="flex flex-col gap-4">
      <Toolbar label={r.pnlView}>
        <Segmented label={r.year} active={String(year)} options={years.map((v) => ({ key: String(v), label: String(v), href: here({ year: v === thisYear ? null : String(v) }) }))} />
        <Segmented
          label={r.pnlView}
          active={group}
          options={[
            { key: "month", label: r.byMonth, href: here({ by: null }) },
            { key: "business_line", label: r.byLine, href: here({ by: "line" }) },
          ]}
        />
        <Segmented
          label={r.includeScheduled}
          active={scheduled ? "1" : "0"}
          options={[
            { key: "0", label: t.withoutScheduled, href: here({ scheduled: null }) },
            { key: "1", label: r.includeScheduled, href: here({ scheduled: "1" }) },
          ]}
        />
      </Toolbar>
      <p className="max-w-prose text-small text-muted">{r.pnlIntro}</p>
      {buckets.length === 0 ? (
        <p className="border-y border-hairline py-6 text-sm text-muted">{r.pnlEmpty}</p>
      ) : (
        <DataTable rows={rows} columns={columns} rowKey={(x) => x.line} mode="scroll" />
      )}
      {unclassified && (
        <p className="text-small text-muted">
          <Link href="/reports/quality" className="text-ink underline underline-offset-4">
            {r.lines.unclassified}
          </Link>
          : {r.unclassifiedHint}
        </p>
      )}
    </section>
  );
}

async function Taxes({ supabase, orgId, canEdit }: { supabase: Supabase; orgId: string; canEdit: boolean }) {
  const todayMonth = currentMonthKey();
  const [{ data: positions }, { data: filings }, { data: withholding }] = await Promise.all([
    supabase
      .from("v_vat_position")
      .select("*")
      .eq("org_id", orgId)
      .gte("period_start", firstOfMonth(addMonths(todayMonth, -6)))
      .lte("period_start", firstOfMonth(addMonths(todayMonth, 6)))
      .order("period_start", { ascending: false }),
    supabase.from("vat_periods").select("period_start, status").eq("org_id", orgId),
    supabase.from("v_withholding_position").select("*").eq("org_id", orgId).order("period_start", { ascending: false }).limit(24),
  ]);
  const filed = new Set((filings ?? []).filter((f) => f.status === "filed" || f.status === "paid").map((f) => f.period_start));
  type Vat = NonNullable<typeof positions>[number];
  const period = (p: Vat) => {
    const start = monthKeyOf(p.period_start!);
    const current = todayMonth >= start && todayMonth <= addMonths(start, Number(p.period_months ?? 1) - 1);
    return (
      <span className="inline-flex flex-wrap items-center gap-1.5 whitespace-nowrap">
        {Number(p.period_months ?? 1) === 3 ? `${r.quarter} ${quarterOf(p.period_start!)}/${p.period_start!.slice(0, 4)}` : formatDate(p.period_start)}
        {p.is_locked && <Badge>{r.vatLocked}</Badge>}
        {current && <Badge tone="navy">{t.current}</Badge>}
      </span>
    );
  };
  const v = el.vat;
  const columns: Column<Vat>[] = [
    { key: "period", header: v.period, primary: true, cell: period },
    { key: "out", header: v.vatIncome, numeric: true, cell: (p) => formatMoney(p.vat_income) },
    { key: "in", header: v.vatExpense, numeric: true, cell: (p) => formatMoney(p.vat_expense) },
    { key: "credit", header: v.credit, numeric: true, cell: (p) => formatMoney(Math.abs(p.credit_balance ?? 0)), hideOnCard: true },
    { key: "payable", header: v.payable, numeric: true, cell: (p) => formatMoney(p.payable_after_credit) },
    { key: "deadline", header: v.deadline, cell: (p) => formatDate(p.filing_deadline) },
    { key: "filed", header: v.filed, cell: (p) => <Badge>{filed.has(p.period_start!) ? v.filed : v.notFiled}</Badge> },
  ];
  type Wh = NonNullable<typeof withholding>[number];
  const whColumns: Column<Wh>[] = [
    { key: "period", header: v.period, primary: true, cell: (w) => formatDate(w.period_start) },
    { key: "amount", header: t.withheld, numeric: true, cell: (w) => formatMoney(w.withheld_total) },
  ];

  return (
    <>
      <section className="flex flex-col gap-4">
        <SectionHeader
          numeral={1}
          title={t.vat}
          actions={
            <ButtonLink href="/api/vat/export" variant="secondary" size="sm">
              {t.exportVat}
            </ButtonLink>
          }
        />
        <p className="max-w-prose text-small text-muted">{r.vatLockHint}</p>
        <DataTable
          rows={positions ?? []}
          columns={columns}
          rowKey={(p) => p.period_start!}
          empty={t.emptyVat}
          rowActions={
            canEdit
              ? (p) => {
                  const isFiled = filed.has(p.period_start!);
                  return <RowAction action={toggleVatFiled} args={[p.period_start!, isFiled]}>{isFiled ? t.unfile : t.markFiled}</RowAction>;
                }
              : undefined
          }
        />
      </section>
      <section className="flex flex-col gap-4">
        <SectionHeader numeral={2} title={t.withholding} />
        <DataTable rows={withholding ?? []} columns={whColumns} rowKey={(w) => w.period_start!} empty={t.emptyWithholding} />
      </section>
    </>
  );
}

const COMPONENTS = ["cash", "other_accounts", "assets", "receivables", "payables", "liabilities", "loans", "vat"] as const;

async function Assets({ supabase, orgId, canEdit, sp }: { supabase: Supabase; orgId: string; canEdit: boolean; sp: Params }) {
  const [{ data: total, error }, { data: assets }, { data: liabilities }] = await Promise.all([
    supabase.from("v_net_worth").select("*").eq("org_id", orgId).maybeSingle(),
    supabase
      .from("assets")
      .select("id, name, category, estimated_value, ownership_pct, owner_scope, state, valuation_date, notes")
      .eq("org_id", orgId)
      .order("name"),
    supabase
      .from("liabilities")
      .select("id, lender, kind, principal, interest_rate, maturity_date, state, owner_scope, terms")
      .eq("org_id", orgId)
      .order("maturity_date", { nullsFirst: false }),
  ]);
  if (error) throw error;
  const n = el.netWorth;
  const amountOf: Record<(typeof COMPONENTS)[number], number> = {
    cash: Number(total?.cash_total ?? 0),
    other_accounts: Number(total?.other_accounts_total ?? 0),
    assets: Number(total?.asset_total ?? 0),
    receivables: Number(total?.receivables_total ?? 0),
    payables: -Number(total?.payables_total ?? 0),
    liabilities: -Number(total?.liability_total ?? 0),
    loans: -Number(total?.loans_total ?? 0),
    vat: Number(total?.vat_total ?? 0),
  };
  const here = (changes: Record<string, string | null>) => withParams(PATH, { view: "assets" }, changes);
  const assetId = canEdit ? one(sp.asset) : null;
  const liabilityId = canEdit ? one(sp.liability) : null;
  const editingAsset = (assets ?? []).find((a) => a.id === assetId);
  const editingLiability = (liabilities ?? []).find((l) => l.id === liabilityId);

  type Asset = NonNullable<typeof assets>[number];
  type Liability = NonNullable<typeof liabilities>[number];
  const assetColumns: Column<Asset>[] = [
    {
      key: "name",
      header: n.name,
      primary: true,
      cell: (a) => (
        <span className="inline-flex flex-wrap items-center gap-1.5">
          {a.name}
          {a.state !== "held" && <Badge>{t.notCounted}</Badge>}
        </span>
      ),
    },
    { key: "category", header: n.category, cell: (a) => a.category ?? "—" },
    { key: "owner", header: n.owner, cell: (a) => el.account.ownerValues[a.owner_scope] },
    { key: "share", header: n.ownership, numeric: true, cell: (a) => `${Math.round(Number(a.ownership_pct) * 10000) / 100}%`, hideOnCard: true },
    { key: "value", header: n.value, numeric: true, cell: (a) => formatMoney(a.estimated_value) },
  ];
  const liabilityColumns: Column<Liability>[] = [
    { key: "lender", header: n.lender, primary: true, cell: (l) => l.lender },
    { key: "kind", header: n.liabilityKind, cell: (l) => n.liabilityKinds[l.kind] },
    { key: "state", header: n.liabilityState, cell: (l) => <Badge>{n.liabilityStates[l.state]}</Badge> },
    { key: "maturity", header: n.maturity, cell: (l) => (l.maturity_date ? formatDate(l.maturity_date) : "—") },
    { key: "principal", header: n.principal, numeric: true, cell: (l) => <Amount value={-Number(l.principal)} format={formatMoney} /> },
  ];
  const menu = (edit: string, remove: (id: string) => Promise<unknown>, id: string) => (
    <>
      <MenuLink href={edit}>{el.common.edit}</MenuLink>
      <MenuSeparator />
      <RowAction action={remove} args={[id]} confirm={t.deleteConfirm} tone="danger">
        {el.common.delete}
      </RowAction>
    </>
  );
  const add = (label: string, href: string) =>
    canEdit && (
      <ButtonLink href={href} variant="secondary" size="sm">
        + {label}
      </ButtonLink>
    );
  const worth = Number(total?.net_worth ?? 0);

  return (
    <>
      <section className="grid gap-6 border-y border-hairline py-6 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <Stat
          label={t.netWorth}
          size="lg"
          value={<span className={worth < 0 ? "text-negative" : undefined}>{formatMoney(worth)}</span>}
          sub={t.netWorthSub}
        />
        <KeyValue
          columns={2}
          items={COMPONENTS.filter((c) => amountOf[c] !== 0 || c === "cash").map((c) => ({
            label: n.components[c],
            value: <Amount value={amountOf[c]} format={formatMoney} />,
            numeric: true,
          }))}
        />
      </section>
      <section className="flex flex-col gap-4">
        <SectionHeader numeral={1} title={n.assetsTitle} actions={add(n.addAsset, here({ asset: "new" }))} />
        <DataTable
          rows={assets ?? []}
          columns={assetColumns}
          rowKey={(a) => a.id}
          empty={n.empty}
          rowActions={canEdit ? (a) => menu(here({ asset: a.id }), removeAsset, a.id) : undefined}
        />
      </section>
      <section className="flex flex-col gap-4">
        <SectionHeader numeral={2} title={n.liabilitiesTitle} actions={add(n.addLiability, here({ liability: "new" }))} />
        <DataTable
          rows={liabilities ?? []}
          columns={liabilityColumns}
          rowKey={(l) => l.id}
          empty={n.empty}
          rowActions={canEdit ? (l) => menu(here({ liability: l.id }), removeLiability, l.id) : undefined}
        />
      </section>
      {(assetId === "new" || editingAsset) && (
        <UrlDrawer title={editingAsset ? n.editAsset : n.addAsset} action={saveAsset.bind(null, editingAsset?.id ?? null)} closeHref={here({})}>
          <AssetFields initial={editingAsset} />
        </UrlDrawer>
      )}
      {(liabilityId === "new" || editingLiability) && (
        <UrlDrawer
          title={editingLiability ? n.editLiability : n.addLiability}
          action={saveLiability.bind(null, editingLiability?.id ?? null)}
          closeHref={here({})}
        >
          <LiabilityFields initial={editingLiability} />
        </UrlDrawer>
      )}
    </>
  );
}
