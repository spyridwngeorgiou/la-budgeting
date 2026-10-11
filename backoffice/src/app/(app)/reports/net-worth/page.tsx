import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrgId } from "@/lib/supabase/org";
import { formatDate, formatMoney, formatPercent } from "@/lib/format";
import { el } from "@/lib/i18n/el";
import {
  KpiBand,
  LINK_CLASS,
  NUM_CLASS,
  PageHeader,
  ReportChart,
  ReportDetail,
  ReportFooter,
  ReportHeadline,
  ReportMethod,
  ReportSection,
  SUB_CLASS,
  SpecTable,
  Td,
  Tr,
  cn,
} from "@/components/ui";
import { BandChart } from "@/components/ui/BandChart";
import { addMonths, currentMonthKey, shortMonthYearLabel, todayAthens } from "@/lib/dates";
import { netWorthNarrative } from "@/lib/finance/narratives";
import { CompositionBars } from "./Composition";
import { liquidMonthEnds } from "./liquidHistory";
import { AssetFormModal, LiabilityFormModal } from "./NetWorthForms";
import { RowDeleteMenu } from "./RowDeleteMenu";
import { deleteAsset, deleteLiability, saveAsset, saveLiability } from "./actions";

// Καθαρή θέση -- «Πόσα αξίζουμε;». Totals and items are v_net_worth /
// v_net_worth_items (0068/0090) only; the two lists below are the hand-kept
// assets and liabilities. The second chart is the ACTUAL liquid balance of
// the last 12 months (v_account_balances + v_account_ledger_monthly, 0091):
// there is no net-worth history, so none is drawn.

const COMPONENTS = ["cash", "other_accounts", "assets", "receivables", "payables", "liabilities", "loans", "vat"] as const;
type Component = (typeof COMPONENTS)[number];
// The order of the segments in the composition bars (VAT on the side its
// sign puts it).
const OWNED_ORDER: Component[] = ["cash", "other_accounts", "assets", "receivables", "vat"];
const OWED_ORDER: Component[] = ["loans", "liabilities", "payables", "vat"];

// Texts new to this tab (the rest are el.netWorth).
const T = {
  question: "Πόσα αξίζουμε;",
  liquidity: "Ρευστότητα",
  liquiditySub: "ρευστά / περιουσία",
  leverage: "Μόχλευση",
  leverageSub: "υποχρεώσεις / περιουσία",
  property: "Ακίνητα",
  propertySub: (n: number) => (n === 1 ? "1 ακίνητο" : `${n} ακίνητα`),
  compositionTitle: "Τι έχουμε και τι οφείλουμε",
  compositionCaption: "Σήμερα, στην ίδια κλίμακα",
  liquidTitle: "Ρευστά τελευταίων 12 μηνών",
  liquidCaption: "Πραγματικό υπόλοιπο ρευστών λογαριασμών στο τέλος κάθε μήνα· ο τρέχων μήνας έως σήμερα",
  liquidSeries: "Ρευστά (πραγματικά)",
  components: "Ανά στοιχείο",
  method: [
    "Καθαρή θέση = ό,τι έχουμε (ρευστά, λοιποί λογαριασμοί, περιουσιακά στοιχεία στο ποσοστό ιδιοκτησίας μας, απαιτήσεις) μείον ό,τι οφείλουμε (δάνεια, λοιπές υποχρεώσεις, εκκρεμείς πληρωμές σε προμηθευτές, ΦΠΑ). Ο ΦΠΑ μετρά στην πλευρά που τον βάζει το πρόσημό του.",
    "Ρευστότητα: τα ρευστά ως μέρος της περιουσίας. Μόχλευση: οι υποχρεώσεις ως μέρος της περιουσίας.",
    "«Ρευστά τελευταίων 12 μηνών»: το σημερινό υπόλοιπο των ρευστών λογαριασμών, μείον τις πληρωμένες κινήσεις κάθε επόμενου μήνα. Ιστορικό καθαρής θέσης δεν κρατείται, γι' αυτό δεν εμφανίζεται.",
  ],
};

// Where each component's items live; receivables and payables are open
// ledger rows (possibly thousands), so they link out instead of listing.
const COMPONENT_HREF: Partial<Record<Component, string>> = {
  cash: "/accounts",
  other_accounts: "/accounts",
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
  const [{ data: total, error }, { data: items }, { data: assets }, { data: liabilities }, { data: liquidAccounts }, { data: ledger }] =
    await Promise.all([
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
      .select("id, name, category, estimated_value, ownership_pct, owner_scope, state, valuation_date, notes")
      .eq("org_id", orgId)
      .order("name"),
    supabase
      .from("liabilities")
      .select("id, lender, kind, principal, interest_rate, maturity_date, state, owner_scope, terms")
      .eq("org_id", orgId)
      .order("maturity_date", { nullsFirst: false }),
    supabase
      .from("v_account_balances")
      .select("account_id, current_balance, opening_balance_date")
      .eq("org_id", orgId)
      .eq("is_liquid", true),
    // Movements paid in the months after the first one shown.
    supabase
      .from("v_account_ledger_monthly")
      .select("account_id, month, inflow, outflow")
      .eq("org_id", orgId)
      .gt("month", monthKeys[0]),
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
  const liquid = liquidMonthEnds(monthKeys, liquidAccounts ?? [], ledger ?? []).map((r) => ({
    label: shortMonthYearLabel(r.month),
    liquid: r.balance,
  }));

  return (
    <div className="flex min-w-0 flex-col gap-10">
      <PageHeader title={t.title} meta={T.question} />

      <ReportSection label={t.title}>
        <ReportHeadline>{netWorthNarrative({ assets: ownedTotal, liabilities: owedTotal })}</ReportHeadline>
        <KpiBand
          items={[
            {
              label: t.total,
              value: <span className={netWorth < 0 ? "text-negative" : undefined}>{formatMoney(netWorth)}</span>,
            },
            {
              label: T.liquidity,
              value: ownedTotal > 0 ? formatPercent(amountOf.cash / ownedTotal, { digits: 0 }) : "—",
              sub: T.liquiditySub,
            },
            {
              label: T.leverage,
              value: ownedTotal > 0 ? formatPercent(owedTotal / ownedTotal, { digits: 0 }) : "—",
              sub: T.leverageSub,
            },
            { label: T.property, value: formatMoney(propertyValue), sub: T.propertySub(property.length) },
          ]}
        />

        {ownedTotal + owedTotal > 0 && (
          <ReportChart title={T.compositionTitle} caption={T.compositionCaption}>
            <CompositionBars rows={composition} label={el.reports.netWorthChartLabel} />
          </ReportChart>
        )}

        {(liquidAccounts ?? []).length > 0 && (
          <ReportChart title={T.liquidTitle} caption={T.liquidCaption}>
            <BandChart data={liquid} xKey="label" series={[{ key: "liquid", name: T.liquidSeries }]} label={T.liquidTitle} markBelow={false} />
          </ReportChart>
        )}

        <ReportDetail title={T.components}>
          <div className="grid min-w-0 grid-cols-1 gap-8 md:grid-cols-2">
            <ComponentTable title={t.owned} components={owned} amountOf={amountOf} itemsOf={itemsOf} />
            <ComponentTable title={t.owed} components={owed} amountOf={amountOf} itemsOf={itemsOf} />
          </div>
        </ReportDetail>

        {/* The «add» triggers sit in the body, never inside the <summary>
            (a form in a summary toggles it on space). */}
        <ReportDetail title={t.assetsTitle} meta={(assets ?? []).length || undefined}>
        <div className="present-hide print-hide -mt-1 mb-3 flex justify-end">
          <AssetFormModal action={saveAsset} />
        </div>
        {(assets ?? []).length === 0 ? (
          <p className="text-body text-muted">{t.empty}</p>
        ) : (
          <SpecTable label={t.assetsTitle}>
            <tbody>
                {(assets ?? []).map((a) => {
                  const counted = a.state === "held";
                  return (
                    <Tr key={a.id} className="[&>td]:align-middle">
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
                      <Td className="py-1.5">
                        <div className="present-hide print-hide flex items-center justify-end gap-1.5">
                          <AssetFormModal
                            action={saveAsset}
                            id={a.id}
                            initial={{
                              name: a.name,
                              category: a.category,
                              estimated_value: Number(a.estimated_value),
                              ownership_pct: Number(a.ownership_pct),
                              owner_scope: a.owner_scope,
                              state: a.state,
                              valuation_date: a.valuation_date,
                              notes: a.notes,
                            }}
                          />
                          <RowDeleteMenu action={deleteAsset} id={a.id} />
                        </div>
                      </Td>
                    </Tr>
                  );
                })}
            </tbody>
          </SpecTable>
        )}
        </ReportDetail>

        <ReportDetail title={t.liabilitiesTitle} meta={(liabilities ?? []).length || undefined}>
        <div className="mb-3 flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <p className="min-w-0 flex-1 text-small text-muted">{t.liabilitiesHint}</p>
          <span className="present-hide print-hide shrink-0">
            <LiabilityFormModal action={saveLiability} />
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
                    <Tr key={l.id} className="[&>td]:align-middle">
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
                      <Td className="py-1.5">
                        <div className="present-hide print-hide flex items-center justify-end gap-1.5">
                          <LiabilityFormModal
                            action={saveLiability}
                            id={l.id}
                            initial={{
                              lender: l.lender,
                              kind: l.kind,
                              principal: Number(l.principal),
                              interest_rate: Number(l.interest_rate),
                              maturity_date: l.maturity_date,
                              state: l.state,
                              owner_scope: l.owner_scope,
                              terms: l.terms,
                            }}
                          />
                          <RowDeleteMenu action={deleteLiability} id={l.id} />
                        </div>
                      </Td>
                    </Tr>
                  );
                })}
            </tbody>
          </SpecTable>
        )}
        </ReportDetail>

        <ReportMethod>
          <p>{t.intro}</p>
          {T.method.map((m, i) => (
            <p key={i}>{m}</p>
          ))}
        </ReportMethod>
        <ReportFooter dataUntil={todayAthens()} />
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
        <h2 className="eyebrow text-muted">{title}</h2>
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
