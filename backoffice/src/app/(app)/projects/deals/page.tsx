import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrgId } from "@/lib/supabase/org";
import { formatDate, formatMoney } from "@/lib/format";
import { el } from "@/lib/i18n/el";
import { Badge, Button, PageHeader, Stat, type Tone } from "@/components/ui";
import { ActionForm } from "@/components/ActionForm";
import { loadLookups } from "@/lib/data/lookups";
import type { DealStage } from "@/lib/domain/enums";
import { DealFormModal } from "./DealFormModal";
import { closeDeal, deleteDeal, saveDeal } from "./actions";

// Colour only where a deal needs attention or has an outcome; violet stays
// the AI family's.
const STAGE_TONE: Record<DealStage, Tone> = {
  lead: "neutral",
  offer: "warning",
  preliminary: "warning",
  closed: "positive",
  lost: "negative",
};

// P15 spec table cells; 44px buttons on phones.
const TH = "eyebrow border-b border-rule px-3 py-2.5 font-medium text-muted";
const TD = "border-b border-hairline px-3 py-3";
const TAP = "max-md:min-h-11";

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
    <div className="flex flex-col gap-10">
      <PageHeader
        title={t.title}
        meta={<span className="block max-w-prose">{t.intro}</span>}
        actions={<DealFormModal action={saveDeal.bind(null, null)} contacts={lookups.contacts} projects={lookups.projects} />}
      />

      {pipeline > 0 && (
        <Stat
          label={t.weighted}
          value={formatMoney(pipeline)}
          sub={
            <Link href="/reports/cash" className="inline-flex min-h-10 items-center text-ink underline underline-offset-4">
              {el.tabs.cash} →
            </Link>
          }
        />
      )}

      {(deals ?? []).length === 0 ? (
        <p className="border-y border-hairline py-6 text-body text-muted">{t.empty}</p>
      ) : (
        // Spec table; scrolls inside its frame on a phone.
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-body">
            <thead>
              <tr>
                <th scope="col" className={TH}>{t.property}</th>
                <th scope="col" className={`${TH} hidden md:table-cell`}>{t.client}</th>
                <th scope="col" className={`${TH} text-right`}>{t.price}</th>
                <th scope="col" className={`${TH} text-right`}>{t.commission}</th>
                <th scope="col" className={TH}>{t.stage}</th>
                <th scope="col" className={`${TH} hidden sm:table-cell`}>{t.expectedClose}</th>
                <th scope="col" className={TH}>
                  <span className="sr-only">{el.common.edit}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {(deals ?? []).map((d) => {
                const contact = Array.isArray(d.contacts) ? d.contacts[0] : d.contacts;
                const commission = d.commission_amount ?? Math.round(Number(d.price) * Number(d.commission_pct) * 100) / 100;
                const weighted = weightedByDeal.get(d.id);
                const isOpen = d.stage !== "closed" && d.stage !== "lost";
                return (
                  <tr key={d.id} className="align-top hover:bg-hover">
                    <td className={`${TD} min-w-40 text-ink`}>
                      {d.property_label}
                      {d.notes && <div className="text-small text-muted">{d.notes}</div>}
                    </td>
                    <td className={`${TD} hidden text-text md:table-cell`}>{contact?.name ?? t.noClient}</td>
                    <td className={`${TD} num text-right whitespace-nowrap text-ink`}>{formatMoney(d.price)}</td>
                    <td className={`${TD} num text-right whitespace-nowrap text-ink`}>
                      {formatMoney(commission)}
                      {weighted != null && <div className="text-small text-muted">{formatMoney(weighted)} στην πρόβλεψη</div>}
                    </td>
                    <td className={TD}>
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <Badge tone={STAGE_TONE[d.stage]}>{t.stages[d.stage]}</Badge>
                        {d.stage === "closed" && d.transaction_id && (
                          <Link href={`/transactions?ids=${d.transaction_id}`} className="text-small text-ink underline underline-offset-4">
                            {t.receivable}
                          </Link>
                        )}
                      </div>
                    </td>
                    <td className={`${TD} num hidden whitespace-nowrap text-text sm:table-cell`}>
                      {formatDate(d.stage === "closed" ? d.closed_on : d.expected_close_date)}
                    </td>
                    <td className={TD}>
                      <div className="flex flex-wrap items-center justify-end gap-2">
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
                              <Button type="submit" variant="secondary" size="sm" className={TAP} title={t.closeConfirm}>
                                {t.close}
                              </Button>
                            </ActionForm>
                          </>
                        )}
                        {d.stage !== "closed" && (
                          <ActionForm action={deleteDeal.bind(null, d.id)}>
                            <Button type="submit" variant="danger" size="sm" className={TAP}>
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
      <p className="max-w-prose text-small text-muted">{t.closeConfirm}</p>
    </div>
  );
}
