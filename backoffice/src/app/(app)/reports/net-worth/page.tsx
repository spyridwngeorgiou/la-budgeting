import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrgId } from "@/lib/supabase/org";
import { formatDate, formatMoney, formatPercent, formatSignedMoney } from "@/lib/format";
import { el } from "@/lib/i18n/el";
import {
  KpiBand,
  LINK_CLASS,
  NUM_CLASS,
  PageHeader,
  ReportChart,
  ReportFooter,
  ReportHistory,
  ReportSection,
  SUB_CLASS,
  SpecTable,
  Td,
  Th,
  Tr,
  cn,
} from "@/components/ui";
import { addMonths, currentMonthKey, firstOfMonth, lastOfMonth, monthLabel, todayAthens } from "@/lib/dates";
import { liquidMonthEnds } from "@/lib/finance/liquidHistory";
import { change, latestUpTo, vsPrevText } from "@/lib/finance/insights";
import { CompositionBars } from "./Composition";
import { KpiLink, ManageLink, reportIssues } from "../Insights";
import { ExportCsvLink } from "../ExportCsvLink";

// Καθαρή θέση -- «Πόσα αξίζουμε;». Totals and items are v_net_worth /
// v_net_worth_items (0068/0090) only; the asset and liability lists are
// the hand-kept ones, read-only here (managed on /accounts/assets). The
// liquid history is the ACTUAL liquid balance of the last 12 months
// (v_account_balances + v_account_ledger_monthly, 0091): there is no
// net-worth history, so none is shown, and «± έναντι προηγ. μήνα» is the
// liquid part's.

const COMPONENTS = ["cash", "other_accounts", "assets", "receivables", "payables", "liabilities", "loans", "vat"] as const;
type Component = (typeof COMPONENTS)[number];
// The order of the segments in the composition bars (VAT on the side its
// sign puts it).
const OWNED_ORDER: Component[] = ["cash", "other_accounts", "assets", "receivables", "vat"];
const OWED_ORDER: Component[] = ["loans", "liabilities", "payables", "vat"];

// Texts new to this tab (the rest are el.netWorth).
const T = {
  meta: "Πόσα αξίζουμε; Ό,τι έχουμε (λογαριασμοί, περιουσιακά στο ποσοστό μας, απαιτήσεις) μείον ό,τι οφείλουμε (δάνεια, υποχρεώσεις, εκκρεμείς πληρωμές, ΦΠΑ), σήμερα.",
  liquid: "Ρευστά",
  liquiditySub: (pct: string) => `${pct} της περιουσίας`,
  owned: "Περιουσιακά",
  propertySub: (n: number, value: string) => `ακίνητα ${value} (${n})`,
  owed: "Υποχρεώσεις",
  leverageSub: (pct: string) => `μόχλευση ${pct} της περιουσίας`,
  netSub: "ιστορικό καθαρής θέσης δεν κρατείται",
  compositionTitle: "Τι έχουμε και τι οφείλουμε",
  compositionCaption: "Σήμερα, στην ίδια κλίμακα",
  liquidHistory: "Ρευστά ανά μήνα",
  liquidHistoryMeta: "πραγματικό υπόλοιπο στο τέλος κάθε μήνα· ο τρέχων έως σήμερα",
  components: "Ανά στοιχείο",
};

// Where each component's items live; receivables and payables are open
// ledger rows (possibly thousands), so they link out instead of listing.
const COMPONENT_HREF: Partial<Record<Component, string>> = {
  cash: "/accounts",
  other_accounts: "/accounts",
  assets: "/accounts/assets",
  liabilities: "/accounts/assets",
  receivables: "/transactions?status=pending&direction=income",
  payables: "/transactions?status=pending&direction=expense",
  loans: "/projects",
  vat: "/reports/vat",
};

export default async function NetWorthPage() {
  const supabase = await createClient();
  const orgId = await getCurrentOrgId(supabase);
  const thisMonth = currentMonthKey();
  const monthKeys = Array.from({ length: 12 }, (_, i) => addMonths(thisMonth, i - 11));
  const yearAgo = addMonths(thisMonth, -12);
  const today = todayAthens();
  const [
    { data: total, error },
    { data: items },
    { data: assets },
    { data: liabilities },
    { data: liquidAccounts },
    { data: ledger },
    issues,
  ] = await Promise.all([
    supabase.from("v_net_worth").select("*").eq("org_id", orgId).maybeSingle(),
    supabase
      .from("v_net_worth_items")
      .select("component, owner_scope, ref_id, label, amount")
      .eq("org_id", orgId)
      .in("component", ["other_accounts", "assets", "liabilities", "loans"])
      .neq("amount", 0)
      .order("amount", { ascending: false }),
    supabase
      .from("assets")
      .select("id, name, category, estimated_value, ownership_pct, owner_scope, state, valuation_date")
      .eq("org_id", orgId)
      .order("name"),
    supabase
      .from("liabilities")
      .select("id, lender, kind, principal, interest_rate, maturity_date, state, owner_scope")
      .eq("org_id", orgId)
      .order("maturity_date", { nullsFirst: false }),
    supabase
      .from("v_account_balances")
      .select("account_id, name, current_balance, opening_balance_date")
      .eq("org_id", orgId)
      .eq("is_liquid", true),
    // Movements paid after the same month last year: the history's months.
    supabase
      .from("v_account_ledger_monthly")
      .select("account_id, month, inflow, outflow")
      .eq("org_id", orgId)
      .gt("month", yearAgo),
    reportIssues(supabase, orgId, "net-worth"),
  ]);
  if (error) throw error;

  const t = el.netWorth;
  const amountOf: Record<Component, number> = {
    cash: Number(total?.cash_total ?? 0),
    other_accounts: Number(total?.other_accounts_total ?? 0),
    assets: Number(total?.asset_total ?? 0),
    receivables: Number(total?.receivables_total ?? 0),
    payables: -Number(total?.payables_total ?? 0),
    liabilities: -Number(total?.liability_total ?? 0),
    loans: -Number(total?.loans_total ?? 0),
    vat: Number(total?.vat_total ?? 0),
  };
  const itemsOf = (c: Component) => (items ?? []).filter((i) => i.component === c);
  // Each component on the side its sign puts it; empty ones are left out
  // (cash always shows, so the left column is never blank).
  const owned = COMPONENTS.filter((c) => amountOf[c] > 0 || c === "cash");
  const owed = COMPONENTS.filter((c) => amountOf[c] < 0);
  const short = (c: Component) => t.components[c].replace(/\s*\(.*\)$/, "");
  const ownedTotal = COMPONENTS.reduce((s, c) => s + Math.max(amountOf[c], 0), 0);
  const owedTotal = COMPONENTS.reduce((s, c) => s + Math.max(-amountOf[c], 0), 0);
  const netWorth = Number(total?.net_worth ?? 0);
  const composition = [
    {
      key: "owned",
      title: t.owned,
      segments: OWNED_ORDER.filter((c) => amountOf[c] > 0).map((c) => ({ key: c, label: short(c), amount: amountOf[c] })),
    },
    {
      key: "owed",
      title: t.owed,
      segments: OWED_ORDER.filter((c) => amountOf[c] < 0).map((c) => ({ key: c, label: short(c), amount: -amountOf[c] })),
    },
  ];
  // Held property at our share, as the net worth counts it.
  const property = (assets ?? []).filter((a) => a.state === "held" && a.category?.toLowerCase() === "property");
  const propertyValue = property.reduce((s, a) => s + Number(a.estimated_value ?? 0) * Number(a.ownership_pct ?? 1), 0);
  // The liquid balance at each month end, newest first in the history.
  const liquid = (liquidAccounts ?? []).length > 0 ? liquidMonthEnds(monthKeys, liquidAccounts ?? [], ledger ?? []) : [];
  const liquidNow = liquid.at(-1)?.balance ?? null;
  const liquidPrev = liquid.at(-2)?.balance ?? null;
  const liquidVsPrev = liquidNow != null ? vsPrevText(change(liquidNow, liquidPrev)) : null;
  const coverage = latestUpTo((ledger ?? []).map((l) => l.month), today);
  const pct = (n: number) => (ownedTotal > 0 ? formatPercent(n / ownedTotal, { digits: 0 }) : "—");

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <PageHeader title={t.title} meta={T.meta} actions={<ExportCsvLink />} />

      <ReportSection label={t.title}>
        <KpiBand
          items={[
            {
              label: t.total,
              value: <span className={netWorth < 0 ? "text-negative" : undefined}>{formatMoney(netWorth)}</span>,
              sub: T.netSub,
            },
            {
              label: T.liquid,
              value: <KpiLink href="/accounts">{formatMoney(amountOf.cash)}</KpiLink>,
              sub: (
                <>
                  {T.liquiditySub(pct(amountOf.cash))}
                  {liquidVsPrev && <span className="block">{liquidVsPrev}</span>}
                </>
              ),
            },
            {
              label: T.owned,
              value: <KpiLink href="/accounts/assets">{formatMoney(ownedTotal)}</KpiLink>,
              sub: T.propertySub(property.length, formatMoney(propertyValue)),
            },
            {
              label: T.owed,
              value: <KpiLink href="/accounts/assets">{formatMoney(owedTotal)}</KpiLink>,
              sub: T.leverageSub(pct(owedTotal)),
            },
          ]}
        />

        {ownedTotal + owedTotal > 0 && (
          <ReportChart title={T.compositionTitle} caption={T.compositionCaption}>
            <CompositionBars rows={composition} label={el.reports.netWorthChartLabel} />
          </ReportChart>
        )}

        {liquid.length > 0 && (
          <ReportHistory title={T.liquidHistory} count={liquid.length} meta={T.liquidHistoryMeta} open>
            <SpecTable label={T.liquidHistory} className="max-w-2xl">
              <thead>
                <tr>
                  <Th>{el.reports.month}</Th>
                  <Th numeric>{T.liquid}</Th>
                  <Th numeric>Μεταβολή</Th>
                </tr>
              </thead>
              <tbody>
                {liquid
                  .map((r, i) => ({ ...r, delta: i > 0 ? r.balance - liquid[i - 1].balance : null }))
                  .reverse()
                  .map((r) => (
                    <Tr key={r.month}>
                      <Td strong className="whitespace-nowrap">
                        <Link href={`/transactions?status=paid&from=${firstOfMonth(r.month)}&to=${lastOfMonth(r.month)}`} className={LINK_CLASS}>
                          {monthLabel(r.month)}
                        </Link>
                      </Td>
                      <Td numeric strong>
                        {formatMoney(r.balance)}
                      </Td>
                      <Td numeric className={r.delta != null && r.delta < 0 ? "text-negative" : "text-muted"}>
                        {r.delta == null ? "—" : formatSignedMoney(r.delta)}
                      </Td>
                    </Tr>
                  ))}
              </tbody>
            </SpecTable>
          </ReportHistory>
        )}

        <ReportHistory title={T.components} count={owned.length + owed.length} open>
          <div className="grid min-w-0 grid-cols-1 gap-8 md:grid-cols-2">
            <ComponentTable title={t.owned} components={owned} amountOf={amountOf} itemsOf={itemsOf} />
            <ComponentTable title={t.owed} components={owed} amountOf={amountOf} itemsOf={itemsOf} />
          </div>
        </ReportHistory>

        {/* Read-only: both lists are managed on Λογαριασμοί → Περιουσία & υποχρεώσεις. */}
        <ReportHistory title={t.assetsTitle} count={(assets ?? []).length} open>
          <ManageLink href="/accounts/assets" />
          {(assets ?? []).length === 0 ? (
            <p className="text-body text-muted">{t.empty}</p>
          ) : (
            <SpecTable label={t.assetsTitle}>
              <tbody>
                {(assets ?? []).map((a) => {
                  const counted = a.state === "held";
                  return (
                    <Tr key={a.id}>
                      <Td className={cn("min-w-48", counted ? "text-ink" : "text-muted")}>
                        {a.name}
                        {a.category && <span className="ml-1 text-small text-muted">· {t.assetCategories[a.category.toLowerCase()] ?? a.category}</span>}
                        <span className={SUB_CLASS}>
                          {el.account.ownerValues[a.owner_scope]}
                          {Number(a.ownership_pct) !== 1 && ` · ${Math.round(Number(a.ownership_pct) * 10000) / 100}%`}
                          {a.valuation_date && ` · ${formatDate(a.valuation_date)}`}
                          {!counted && ` · ${t.assetStates.pending_inheritance}`}
                        </span>
                      </Td>
                      <Td numeric className={counted ? "text-ink" : "text-muted"}>
                        {formatMoney(a.estimated_value)}
                      </Td>
                    </Tr>
                  );
                })}
              </tbody>
            </SpecTable>
          )}
        </ReportHistory>

        <ReportHistory title={t.liabilitiesTitle} count={(liabilities ?? []).length} open>
          <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
            <p className="min-w-0 flex-1 text-small text-muted">{t.liabilitiesHint}</p>
            <span className="shrink-0">
              <ManageLink href="/accounts/assets" />
            </span>
          </div>
          {(liabilities ?? []).length === 0 ? (
            <p className="text-body text-muted">{t.empty}</p>
          ) : (
            <SpecTable label={t.liabilitiesTitle}>
              <tbody>
                {(liabilities ?? []).map((l) => {
                  const counted = l.state === "disbursed";
                  return (
                    <Tr key={l.id}>
                      <Td className={cn("min-w-48", counted ? "text-ink" : "text-muted")}>
                        {l.lender}
                        <span className="ml-1 text-small text-muted">· {t.liabilityKinds[l.kind]}</span>
                        <span className={SUB_CLASS}>
                          {t.liabilityStates[l.state]} · {el.account.ownerValues[l.owner_scope]}
                          {Number(l.interest_rate) > 0 && ` · ${Math.round(Number(l.interest_rate) * 100000) / 1000}%`}
                          {l.maturity_date && ` · ${t.maturity} ${formatDate(l.maturity_date)}`}
                        </span>
                      </Td>
                      <Td numeric className={counted ? "text-ink" : "text-muted"}>
                        {formatMoney(l.principal)}
                      </Td>
                    </Tr>
                  );
                })}
              </tbody>
            </SpecTable>
          )}
        </ReportHistory>

        <ReportFooter dataUntil={coverage ?? today} issues={issues} />
      </ReportSection>
    </div>
  );
}

type Item = { component: string | null; ref_id: string | null; label: string | null; amount: number | null };

function ComponentTable({
  title,
  components,
  amountOf,
  itemsOf,
}: {
  title: string;
  components: readonly Component[];
  amountOf: Record<Component, number>;
  itemsOf: (c: Component) => Item[];
}) {
  const t = el.netWorth;
  const sum = components.reduce((s, c) => s + amountOf[c], 0);
  return (
    <section className="flex min-w-0 flex-col">
      <div className="flex items-baseline justify-between gap-3 border-b border-rule pb-2">
        <h3 className="eyebrow text-muted">{title}</h3>
        <span className="num text-figure-sm font-light text-ink">{formatMoney(sum)}</span>
      </div>
      {components.length === 0 ? (
        <p className="py-3 text-body text-muted">{t.empty}</p>
      ) : (
        <ul className="flex flex-col text-body">
          {components.map((c) => {
            const href = COMPONENT_HREF[c];
            const list = itemsOf(c);
            return (
              <li key={c} className="border-b border-hairline py-2.5">
                <div className="flex justify-between gap-3 text-ink">
                  {href ? (
                    <Link href={href} className={LINK_CLASS}>
                      {t.components[c]}
                    </Link>
                  ) : (
                    <span>{t.components[c]}</span>
                  )}
                  <span className={NUM_CLASS}>{formatMoney(amountOf[c])}</span>
                </div>
                {list.length > 0 && (
                  <ul className="mt-1 flex flex-col gap-0.5 pl-3 text-small text-muted">
                    {list.map((i) => (
                      <li key={`${c}:${i.ref_id}`} className="flex justify-between gap-3">
                        <span className="min-w-0 truncate">{i.label || "—"}</span>
                        <span className={cn("shrink-0", NUM_CLASS)}>{formatMoney(i.amount ?? 0)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
