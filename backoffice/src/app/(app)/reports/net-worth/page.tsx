import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrgId } from "@/lib/supabase/org";
import { formatDate, formatMoney } from "@/lib/format";
import { el } from "@/lib/i18n/el";
import { Button, PageHeader, SectionHeader, Stat, cn } from "@/components/ui";
import { ArgsActionForm } from "@/components/ArgsActionForm";
import { BarChart } from "@/components/ui/BarChart";
import { netWorthRows } from "@/lib/finance/reportCharts";
import { FRAME, LINK, NUM, ROW, SUB, TABLE, TOUCH } from "../ui";
import { AssetFormModal, LiabilityFormModal } from "./NetWorthForms";
import { deleteAsset, deleteLiability, saveAsset, saveLiability } from "./actions";

// Καθαρή θέση. Totals and items are v_net_worth / v_net_worth_items (0068)
// only; the two lists below are the hand-kept assets and liabilities, which
// had no screen before.

const COMPONENTS = ["cash", "other_accounts", "assets", "receivables", "payables", "liabilities", "loans", "vat"] as const;
type Component = (typeof COMPONENTS)[number];

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
  const [{ data: total, error }, { data: items }, { data: assets }, { data: liabilities }] = await Promise.all([
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
  // The composition as horizontal bars: what we own (navy) over what we owe.
  const chartRows = netWorthRows(amountOf, COMPONENTS, (c) => t.components[c].replace(/\s*\(.*\)$/, ""));

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <PageHeader title={t.title} meta={<span className="block max-w-3xl">{t.intro}</span>} />

      <div className="border-b border-hairline pb-5">
        <Stat
          size="lg"
          label={t.total}
          value={<span className={Number(total?.net_worth ?? 0) < 0 ? "text-negative" : undefined}>{formatMoney(total?.net_worth ?? 0)}</span>}
        />
      </div>

      {chartRows.length > 0 && (
        <BarChart
          label={el.reports.netWorthChartLabel}
          data={chartRows}
          xKey="label"
          layout="rows"
          series={[{ key: "amount", name: t.total }]}
          toneKey="tone"
          legend={[
            { name: t.owned, tone: "navy" },
            { name: t.owed, tone: "negative" },
          ]}
        />
      )}

      <div className="grid min-w-0 grid-cols-1 gap-8 md:grid-cols-2">
        <ComponentTable title={t.owned} components={owned} amountOf={amountOf} itemsOf={itemsOf} />
        <ComponentTable title={t.owed} components={owed} amountOf={amountOf} itemsOf={itemsOf} />
      </div>

      <section className="flex min-w-0 flex-col gap-3">
        <SectionHeader title={t.assetsTitle} actions={<AssetFormModal action={saveAsset} />} />
        {(assets ?? []).length === 0 ? (
          <p className="text-sm text-muted">{t.empty}</p>
        ) : (
          <div className={FRAME}>
            <table className={TABLE}>
              <tbody>
                {(assets ?? []).map((a) => {
                  const counted = a.state === "held";
                  return (
                    <tr key={a.id} className={cn(ROW, !counted && "text-muted")}>
                      <td className={cn("min-w-48 py-2.5 pr-3 align-middle", counted ? "text-ink" : "text-muted")}>
                        {a.name}
                        {a.category && <span className="ml-1 text-xs text-muted">· {a.category}</span>}
                        <span className={SUB}>
                          {el.account.ownerValues[a.owner_scope]}
                          {Number(a.ownership_pct) !== 1 && ` · ${Math.round(Number(a.ownership_pct) * 10000) / 100}%`}
                          {a.valuation_date && ` · ${formatDate(a.valuation_date)}`}
                          {!counted && ` · ${t.assetStates.pending_inheritance}`}
                        </span>
                      </td>
                      <td className={cn("py-2.5 pr-3 align-middle", NUM, counted ? "text-ink" : "text-muted")}>
                        {formatMoney(a.estimated_value)}
                      </td>
                      <td className="py-1.5 align-middle">
                        <div className="flex items-center justify-end gap-1.5">
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
                          <ArgsActionForm action={deleteAsset} args={[a.id]}>
                            <Button type="submit" variant="secondary" size="sm" className={TOUCH}>
                              {el.common.delete}
                            </Button>
                          </ArgsActionForm>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="flex min-w-0 flex-col gap-3">
        <SectionHeader title={t.liabilitiesTitle} actions={<LiabilityFormModal action={saveLiability} />} />
        <p className="text-small text-muted">{t.liabilitiesHint}</p>
        {(liabilities ?? []).length === 0 ? (
          <p className="text-sm text-muted">{t.empty}</p>
        ) : (
          <div className={FRAME}>
            <table className={TABLE}>
              <tbody>
                {(liabilities ?? []).map((l) => {
                  const counted = l.state === "disbursed";
                  return (
                    <tr key={l.id} className={ROW}>
                      <td className={cn("min-w-48 py-2.5 pr-3 align-middle", counted ? "text-ink" : "text-muted")}>
                        {l.lender}
                        <span className="ml-1 text-xs text-muted">· {t.liabilityKinds[l.kind]}</span>
                        <span className={SUB}>
                          {t.liabilityStates[l.state]} · {el.account.ownerValues[l.owner_scope]}
                          {Number(l.interest_rate) > 0 && ` · ${Math.round(Number(l.interest_rate) * 100000) / 1000}%`}
                          {l.maturity_date && ` · ${t.maturity} ${formatDate(l.maturity_date)}`}
                        </span>
                      </td>
                      <td className={cn("py-2.5 pr-3 align-middle", NUM, counted ? "text-ink" : "text-muted")}>
                        {formatMoney(l.principal)}
                      </td>
                      <td className="py-1.5 align-middle">
                        <div className="flex items-center justify-end gap-1.5">
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
                          <ArgsActionForm action={deleteLiability} args={[l.id]}>
                            <Button type="submit" variant="secondary" size="sm" className={TOUCH}>
                              {el.common.delete}
                            </Button>
                          </ArgsActionForm>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
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
        <p className="py-3 text-sm text-muted">{t.empty}</p>
      ) : (
        <ul className="flex flex-col text-sm">
          {components.map((c) => {
            const href = COMPONENT_HREF[c];
            const list = itemsOf(c);
            return (
              <li key={c} className={cn(ROW, "py-2.5")}>
                <div className="flex justify-between gap-3 text-ink">
                  {href ? (
                    <Link href={href} className={LINK}>
                      {t.components[c]}
                    </Link>
                  ) : (
                    <span>{t.components[c]}</span>
                  )}
                  <span className={NUM}>{formatMoney(amountOf[c])}</span>
                </div>
                {list.length > 0 && (
                  <ul className="mt-1 flex flex-col gap-0.5 pl-3 text-xs text-muted">
                    {list.map((i) => (
                      <li key={`${c}:${i.ref_id}`} className="flex justify-between gap-3">
                        <span className="min-w-0 truncate">{i.label || "—"}</span>
                        <span className={cn("shrink-0", NUM)}>{formatMoney(i.amount ?? 0)}</span>
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
