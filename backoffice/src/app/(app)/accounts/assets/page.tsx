import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrgId } from "@/lib/supabase/org";
import { formatDate, formatMoney } from "@/lib/format";
import { el } from "@/lib/i18n/el";
import { PageHeader, SUB_CLASS, SectionHeader, SpecTable, Td, Tr, cn } from "@/components/ui";
import { AssetFormModal, LiabilityFormModal } from "./NetWorthForms";
import { RowDeleteMenu } from "./RowDeleteMenu";
import { deleteAsset, deleteLiability, saveAsset, saveLiability } from "./actions";

// Περιουσία & υποχρεώσεις: the hand-kept assets and liabilities (0008),
// moved as they were from the Καθαρή θέση report, which now only reads
// them. Every total stays v_net_worth (0068) on /reports/net-worth.
export default async function AssetsPage() {
  const supabase = await createClient();
  const orgId = await getCurrentOrgId(supabase);
  const [{ data: assets }, { data: liabilities }] = await Promise.all([
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
  const t = el.netWorth;

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <PageHeader
        title={el.tabs.assetsLiabilities}
        meta={
          <>
            Τα περιουσιακά στοιχεία και οι λοιπές υποχρεώσεις που μετρά η{" "}
            <Link href="/reports/net-worth" className="text-ink underline underline-offset-4">
              {t.title}
            </Link>
            .
          </>
        }
      />

      <section className="flex min-w-0 flex-col gap-4">
        <SectionHeader title={t.assetsTitle} actions={<AssetFormModal action={saveAsset} />} />
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
                        <RowDeleteMenu action={deleteAsset} id={a.id} />
                      </div>
                    </Td>
                  </Tr>
                );
              })}
            </tbody>
          </SpecTable>
        )}
      </section>

      <section className="flex min-w-0 flex-col gap-4">
        <SectionHeader title={t.liabilitiesTitle} actions={<LiabilityFormModal action={saveLiability} />} />
        <p className="text-small text-muted">{t.liabilitiesHint}</p>
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
                        <RowDeleteMenu action={deleteLiability} id={l.id} />
                      </div>
                    </Td>
                  </Tr>
                );
              })}
            </tbody>
          </SpecTable>
        )}
      </section>
    </div>
  );
}
