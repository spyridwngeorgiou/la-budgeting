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
import { addMonths, currentMonthKey, firstOfMonth, monthLabel, shortMonthYearLabel, todayAthens } from "@/lib/dates";
import { netWorthNarrative } from "@/lib/finance/narratives";
import { liquidMonthEnds } from "@/lib/finance/liquidHistory";
import { accountBalancesAt, change, contributors, latestUpTo, sumParts, topMovements, whyText } from "@/lib/finance/insights";
import { CompositionBars } from "./Composition";
import { ChangePanel, KpiLink, ManageLink, TopMovements } from "../Insights";

// Καθαρή θέση -- «Πόσα αξίζουμε;». Totals and items are v_net_worth /
// v_net_worth_items (0068/0090) only; the two lists below are the hand-kept
// assets and liabilities, read-only here (managed on /accounts/assets). The
// second chart is the ACTUAL liquid balance of the last 12 months
// (v_account_balances + v_account_ledger_monthly, 0091): there is no
// net-worth history, so none is drawn, and «Τι άλλαξε» is the liquid part.
//
// Queries: the six it always had, plus this month's largest paid movements
// (v_account_ledger) for «Μεγαλύτερες κινήσεις».

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
  changeTitle: "Τι άλλαξε στα ρευστά",
  vsEndOf: (m: string) => `Έναντι τέλους ${m}`,
  movesCaption: (m: string) => `ρευστοί λογαριασμοί, ${m}`,
  components: "Ανά στοιχείο",
  method: [
    "Καθαρή θέση = ό,τι έχουμε (ρευστά, λοιποί λογαριασμοί, περιουσιακά στοιχεία στο ποσοστό ιδιοκτησίας μας, απαιτήσεις) μείον ό,τι οφείλουμε (δάνεια, λοιπές υποχρεώσεις, εκκρεμείς πληρωμές σε προμηθευτές, ΦΠΑ). Ο ΦΠΑ μετρά στην πλευρά που τον βάζει το πρόσημό του.",
    "Ρευστότητα: τα ρευστά ως μέρος της περιουσίας. Μόχλευση: οι υποχρεώσεις ως μέρος της περιουσίας.",
    "«Ρευστά τελευταίων 12 μηνών»: το σημερινό υπόλοιπο των ρευστών λογαριασμών, μείον τις πληρωμένες κινήσεις κάθε επόμενου μήνα. Ιστορικό καθαρής θέσης δεν κρατείται, γι' αυτό δεν εμφανίζεται.",
    "«Τι άλλαξε στα ρευστά»: το σημερινό υπόλοιπο των ρευστών έναντι του τέλους του προηγούμενου μήνα και του ίδιου μήνα πέρσι, με τους λογαριασμούς που το κίνησαν περισσότερο. «Μεγαλύτερες κινήσεις»: οι μεγαλύτερες πληρωμένες κινήσεις του μήνα στους ρευστούς λογαριασμούς.",
    "Τα περιουσιακά στοιχεία και οι λοιπές υποχρεώσεις καταχωρίζονται στους Λογαριασμούς → Περιουσία & υποχρεώσεις.",
  ],
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
  const lastMonth = addMonths(thisMonth, -1);
  const yearAgo = addMonths(thisMonth, -12);
  const today = todayAthens();
  const [
    { data: total, error },
    { data: items },
    { data: assets },
    { data: liabilities },
    { data: liquidAccounts },
    { data: ledger },
    { data: moves },
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
    // Movements paid after the same month last year: the chart's months and
    // «Τι άλλαξε» against a year ago.
    supabase
      .from("v_account_ledger_monthly")
      .select("account_id, month, inflow, outflow")
      .eq("org_id", orgId)
      .gt("month", yearAgo),
    // This month's largest paid movements (any account; the liquid ones are
    // kept below).
    supabase
      .from("v_account_ledger")
      .select("transaction_id, account_id, paid_date, signed_amount, party_name, description")
      .eq("org_id", orgId)
      .gte("paid_date", firstOfMonth(thisMonth))
      .lte("paid_date", today)
      .order("gross_amount", { ascending: false })
      .limit(25),
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

  // «Τι άλλαξε»: the liquid balance now against the end of last month and
  // of the same month last year, and the accounts that moved it most.
  const at = (m: string) => accountBalancesAt(liquidAccounts ?? [], ledger ?? [], m, thisMonth);
  const now = at(thisMonth);
  const changes =
    (liquidAccounts ?? []).length === 0
      ? []
      : [lastMonth, yearAgo].map((m) => {
          const before = at(m);
          return {
            label: T.vsEndOf(monthLabel(m)),
            change: change(sumParts(now), sumParts(before)),
            why: whyText(contributors(now, before)),
            href: "/accounts",
          };
        });
  const liquidIds = new Set((liquidAccounts ?? []).map((a) => a.account_id));
  const topMoves = topMovements(
    (moves ?? [])
      .filter((m) => liquidIds.has(m.account_id))
      .map((m) => ({
        id: m.transaction_id,
        date: m.paid_date,
        label: m.party_name?.trim() || m.description?.trim() || "—",
        amount: Number(m.signed_amount ?? 0),
      })),
  );
  const coverage = latestUpTo([...topMoves.map((m) => m.date), ...(ledger ?? []).map((l) => l.month)], today);

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
              value: <KpiLink href="/accounts">{ownedTotal > 0 ? formatPercent(amountOf.cash / ownedTotal, { digits: 0 }) : "—"}</KpiLink>,
              sub: T.liquiditySub,
            },
            {
              label: T.leverage,
              value: <KpiLink href="/accounts/assets">{ownedTotal > 0 ? formatPercent(owedTotal / ownedTotal, { digits: 0 }) : "—"}</KpiLink>,
              sub: T.leverageSub,
            },
            {
              label: T.property,
              value: <KpiLink href="/accounts/assets">{formatMoney(propertyValue)}</KpiLink>,
              sub: T.propertySub(property.length),
            },
          ]}
        />

        <ChangePanel title={T.changeTitle} items={changes} coverage={coverage} />

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

        <TopMovements rows={topMoves} caption={T.movesCaption(monthLabel(thisMonth))} />

        <ReportDetail title={T.components}>
          <div className="grid min-w-0 grid-cols-1 gap-8 md:grid-cols-2">
            <ComponentTable title={t.owned} components={owned} amountOf={amountOf} itemsOf={itemsOf} />
            <ComponentTable title={t.owed} components={owed} amountOf={amountOf} itemsOf={itemsOf} />
          </div>
        </ReportDetail>

        {/* Read-only: both lists are managed on Λογαριασμοί → Περιουσία & υποχρεώσεις. */}
        <ReportDetail title={t.assetsTitle} meta={(assets ?? []).length || undefined}>
          <div className="-mt-1 mb-3 flex justify-end">
            <ManageLink href="/accounts/assets" />
          </div>
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
        </ReportDetail>

        <ReportDetail title={t.liabilitiesTitle} meta={(liabilities ?? []).length || undefined}>
          <div className="mb-3 flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
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
        </ReportDetail>

        <ReportMethod>
          <p>{t.intro}</p>
          {T.method.map((m, i) => (
            <p key={i}>{m}</p>
          ))}
        </ReportMethod>
        <ReportFooter dataUntil={coverage ?? today} />
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
