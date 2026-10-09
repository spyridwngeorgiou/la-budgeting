import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrgId } from "@/lib/supabase/org";
import { formatDate, formatMoney } from "@/lib/format";
import { el } from "@/lib/i18n/el";
import { Badge, Button } from "@/components/ui";
import { ActionForm } from "@/components/ActionForm";
import { loadLookups } from "@/lib/data/lookups";
import type { DealStage } from "@/lib/domain/enums";
import { DealFormModal } from "./DealFormModal";
import { closeDeal, deleteDeal, saveDeal } from "./actions";

const STAGE_TONE: Record<DealStage, "neutral" | "amber" | "green" | "red" | "ai"> = {
  lead: "neutral",
  offer: "amber",
  preliminary: "ai",
  closed: "green",
  lost: "red",
};

// Μεσιτεία: the deals list. What each open deal contributes to the cash
// forecast is read back from v_cash_forecast_items (its stage weight lives
// in SQL, deal_stage_probability), never recomputed here.
export default async function DealsPage() {
  const supabase = await createClient();
  const orgId = await getCurrentOrgId(supabase);
  const t = el.deals;

  const [{ data: deals }, { data: forecastDeals }, lookups] = await Promise.all([
    supabase
      .from("brokerage_deals")
      .select(
        "id, property_label, price, commission_pct, commission_amount, stage, expected_close_date, closed_on, transaction_id, client_contact_id, project_id, notes, contacts(name)",
      )
      .eq("org_id", orgId)
      .order("stage")
      .order("expected_close_date", { ascending: true, nullsFirst: false }),
    supabase.from("v_cash_forecast_items").select("ref_id, amount, probability").eq("org_id", orgId).eq("source", "deal"),
    loadLookups(supabase, orgId, { include: ["contacts", "projects"] }),
  ]);

  const weightedByDeal = new Map((forecastDeals ?? []).map((f) => [f.ref_id, Number(f.amount) * Number(f.probability)]));
  const pipeline = [...weightedByDeal.values()].reduce((s, v) => s + v, 0);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{t.title}</h1>
          <p className="mt-1 text-sm text-ink-muted">{t.intro}</p>
        </div>
        <DealFormModal action={saveDeal.bind(null, null)} contacts={lookups.contacts} projects={lookups.projects} />
      </div>

      {pipeline > 0 && (
        <p className="text-sm">
          {t.weighted}: <span className="font-mono font-medium">{formatMoney(pipeline)}</span>{" "}
          <Link href="/reports/cash" className="text-xs text-ink-muted underline">
            {el.tabs.cash}
          </Link>
        </p>
      )}

      {(deals ?? []).length === 0 ? (
        <p className="p-6 text-center text-sm text-ink-muted">{t.empty}</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line">
          <table className="w-full text-left text-sm">
            <thead className="bg-bg text-ink-muted">
              <tr>
                <th className="p-2">{t.property}</th>
                <th className="hidden p-2 md:table-cell">{t.client}</th>
                <th className="p-2 text-right">{t.price}</th>
                <th className="p-2 text-right">{t.commission}</th>
                <th className="p-2">{t.stage}</th>
                <th className="hidden p-2 sm:table-cell">{t.expectedClose}</th>
                <th className="p-2"></th>
              </tr>
            </thead>
            <tbody>
              {(deals ?? []).map((d) => {
                const contact = Array.isArray(d.contacts) ? d.contacts[0] : d.contacts;
                const commission = d.commission_amount ?? Math.round(Number(d.price) * Number(d.commission_pct) * 100) / 100;
                const weighted = weightedByDeal.get(d.id);
                const isOpen = d.stage !== "closed" && d.stage !== "lost";
                return (
                  <tr key={d.id} className="border-t border-line align-top">
                    <td className="p-2">
                      {d.property_label}
                      {d.notes && <div className="text-xs text-ink-faint">{d.notes}</div>}
                    </td>
                    <td className="hidden p-2 md:table-cell">{contact?.name ?? t.noClient}</td>
                    <td className="p-2 text-right font-mono">{formatMoney(d.price)}</td>
                    <td className="p-2 text-right font-mono">
                      {formatMoney(commission)}
                      {weighted != null && <div className="text-[10px] text-ink-faint">{formatMoney(weighted)} στην πρόβλεψη</div>}
                    </td>
                    <td className="p-2">
                      <Badge tone={STAGE_TONE[d.stage]}>{t.stages[d.stage]}</Badge>
                      {d.stage === "closed" && d.transaction_id && (
                        <Link href={`/transactions?ids=${d.transaction_id}`} className="ml-1.5 text-xs text-ink-muted underline">
                          {t.receivable}
                        </Link>
                      )}
                    </td>
                    <td className="hidden p-2 text-ink-muted sm:table-cell">
                      {formatDate(d.stage === "closed" ? d.closed_on : d.expected_close_date)}
                    </td>
                    <td className="p-2">
                      <div className="flex flex-wrap items-center justify-end gap-1.5">
                        {isOpen && (
                          <>
                            <DealFormModal
                              action={saveDeal.bind(null, d.id)}
                              contacts={lookups.contacts}
                              projects={lookups.projects}
                              trigger={el.common.edit}
                              initial={{
                                property_label: d.property_label,
                                price: Number(d.price),
                                commission_pct: Number(d.commission_pct),
                                commission_amount: d.commission_amount,
                                stage: d.stage,
                                expected_close_date: d.expected_close_date,
                                client_contact_id: d.client_contact_id,
                                project_id: d.project_id,
                                notes: d.notes,
                              }}
                            />
                            <ActionForm action={closeDeal.bind(null, d.id)}>
                              <Button type="submit" className="!px-2 !py-1 text-xs" title={t.closeConfirm}>
                                {t.close}
                              </Button>
                            </ActionForm>
                          </>
                        )}
                        {d.stage !== "closed" && (
                          <ActionForm action={deleteDeal.bind(null, d.id)}>
                            <Button type="submit" variant="secondary" className="!px-2 !py-1 text-xs">
                              {el.common.delete}
                            </Button>
                          </ActionForm>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-ink-faint">{t.closeConfirm}</p>
    </div>
  );
}
