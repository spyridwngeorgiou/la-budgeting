import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrgId } from "@/lib/supabase/org";
import { formatDate, formatMoney } from "@/lib/format";
import { el } from "@/lib/i18n/el";
import { Button, Card } from "@/components/ui";
import { ActionForm } from "@/components/ActionForm";
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

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold">{t.title}</h1>
        <p className="mt-1 max-w-3xl text-sm text-ink-muted">{t.intro}</p>
      </div>

      <Card>
        <div className="text-xs text-ink-muted">{t.total}</div>
        <div className={`font-mono text-2xl ${Number(total?.net_worth ?? 0) < 0 ? "text-red-ink" : ""}`}>
          {formatMoney(total?.net_worth ?? 0)}
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <ComponentTable title={t.owned} components={owned} amountOf={amountOf} itemsOf={itemsOf} />
        <ComponentTable title={t.owed} components={owed} amountOf={amountOf} itemsOf={itemsOf} />
      </div>

      <section className="rounded-lg border border-line p-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h2 className="text-sm font-medium">{t.assetsTitle}</h2>
          <AssetFormModal action={saveAsset.bind(null, null)} />
        </div>
        {(assets ?? []).length === 0 ? (
          <p className="text-sm text-ink-muted">{t.empty}</p>
        ) : (
          <table className="w-full text-left text-sm">
            <tbody>
              {(assets ?? []).map((a) => {
                const counted = a.state === "held";
                return (
                  <tr key={a.id} className={`border-t border-line first:border-0 ${counted ? "" : "text-ink-faint"}`}>
                    <td className="py-1.5 pr-2">
                      {a.name}
                      {a.category && <span className="ml-1 text-xs text-ink-muted">· {a.category}</span>}
                      <span className="block text-xs text-ink-faint">
                        {el.account.ownerValues[a.owner_scope]}
                        {Number(a.ownership_pct) !== 1 && ` · ${Math.round(Number(a.ownership_pct) * 10000) / 100}%`}
                        {a.valuation_date && ` · ${formatDate(a.valuation_date)}`}
                        {!counted && ` · ${t.assetStates.pending_inheritance}`}
                      </span>
                    </td>
                    <td className="py-1.5 pr-2 text-right font-mono">{formatMoney(a.estimated_value)}</td>
                    <td className="py-1.5">
                      <div className="flex items-center justify-end gap-1.5">
                        <AssetFormModal
                          action={saveAsset.bind(null, a.id)}
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
                        <ActionForm action={deleteAsset.bind(null, a.id)}>
                          <Button type="submit" variant="secondary" className="!px-2 !py-1 text-xs">
                            {el.common.delete}
                          </Button>
                        </ActionForm>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      <section className="rounded-lg border border-line p-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h2 className="text-sm font-medium">{t.liabilitiesTitle}</h2>
          <LiabilityFormModal action={saveLiability.bind(null, null)} />
        </div>
        <p className="mb-2 text-xs text-ink-faint">{t.liabilitiesHint}</p>
        {(liabilities ?? []).length === 0 ? (
          <p className="text-sm text-ink-muted">{t.empty}</p>
        ) : (
          <table className="w-full text-left text-sm">
            <tbody>
              {(liabilities ?? []).map((l) => {
                const counted = l.state === "disbursed";
                return (
                  <tr key={l.id} className={`border-t border-line first:border-0 ${counted ? "" : "text-ink-faint"}`}>
                    <td className="py-1.5 pr-2">
                      {l.lender}
                      <span className="ml-1 text-xs text-ink-muted">· {t.liabilityKinds[l.kind]}</span>
                      <span className="block text-xs text-ink-faint">
                        {t.liabilityStates[l.state]} · {el.account.ownerValues[l.owner_scope]}
                        {Number(l.interest_rate) > 0 && ` · ${Math.round(Number(l.interest_rate) * 100000) / 1000}%`}
                        {l.maturity_date && ` · ${t.maturity} ${formatDate(l.maturity_date)}`}
                      </span>
                    </td>
                    <td className="py-1.5 pr-2 text-right font-mono">{formatMoney(l.principal)}</td>
                    <td className="py-1.5">
                      <div className="flex items-center justify-end gap-1.5">
                        <LiabilityFormModal
                          action={saveLiability.bind(null, l.id)}
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
                        <ActionForm action={deleteLiability.bind(null, l.id)}>
                          <Button type="submit" variant="secondary" className="!px-2 !py-1 text-xs">
                            {el.common.delete}
                          </Button>
                        </ActionForm>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
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
    <section className="rounded-lg border border-line p-3">
      <div className="mb-2 flex justify-between text-sm font-medium">
        <span>{title}</span>
        <span className="font-mono">{formatMoney(sum)}</span>
      </div>
      {components.length === 0 ? (
        <p className="text-sm text-ink-muted">{t.empty}</p>
      ) : (
        <ul className="flex flex-col gap-2 text-sm">
          {components.map((c) => {
            const href = COMPONENT_HREF[c];
            const list = itemsOf(c);
            return (
              <li key={c}>
                <div className="flex justify-between gap-2">
                  {href ? (
                    <Link href={href} className="hover:underline">
                      {t.components[c]}
                    </Link>
                  ) : (
                    <span>{t.components[c]}</span>
                  )}
                  <span className="font-mono">{formatMoney(amountOf[c])}</span>
                </div>
                {list.length > 0 && (
                  <ul className="mt-0.5 flex flex-col gap-0.5 pl-3 text-xs text-ink-muted">
                    {list.map((i) => (
                      <li key={`${c}:${i.ref_id}`} className="flex justify-between gap-2">
                        <span className="min-w-0 truncate">{i.label || "—"}</span>
                        <span className="shrink-0 font-mono">{formatMoney(i.amount ?? 0)}</span>
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
