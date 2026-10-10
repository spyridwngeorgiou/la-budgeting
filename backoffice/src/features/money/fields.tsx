import { Checkbox, Field, Input, Select } from "@/components/ui";
import { el } from "@/lib/i18n/el";
import { money } from "@/lib/i18n/v2/money";
import { todayAthens } from "@/lib/dates";
import type { Database, Tables } from "@/lib/db/types";
import { ACCOUNT_KIND, ASSET_STATE, DEAL_STAGE, LIABILITY_KIND, LIABILITY_STATE } from "@/lib/domain/enums";

// The field sets of the «Χρήματα» drawers, rendered on the server inside a
// UrlDrawer. Field names are the legacy server actions' contract
// (reports/cash, projects/deals, accounts, contacts, reports/net-worth
// actions.ts) -- keep them.

const two = "grid grid-cols-2 gap-3";
type Opt = { id: string; label: string };
type Init<T extends keyof Database["public"]["Tables"]> = Partial<Tables<T>>;

function Pick({ name, items, value }: { name: string; items: Opt[]; value?: string | null }) {
  return (
    <Select name={name} defaultValue={value ?? ""}>
      <option value="">—</option>
      {items.map((o) => (
        <option key={o.id} value={o.id}>
          {o.label}
        </option>
      ))}
    </Select>
  );
}

function OwnerSelect({ value, fallback }: { value?: string | null; fallback: "corporate" | "personal" }) {
  return (
    <Select name="owner_scope" defaultValue={value ?? fallback}>
      <option value="corporate">{el.account.ownerValues.corporate}</option>
      <option value="personal">{el.account.ownerValues.personal}</option>
    </Select>
  );
}

function Choices<T extends string>({ name, values, labels, value }: { name: string; values: readonly T[]; labels: Record<T, string>; value?: string | null }) {
  return (
    <Select name={name} defaultValue={value ?? values[0]}>
      {values.map((v) => (
        <option key={v} value={v}>
          {labels[v]}
        </option>
      ))}
    </Select>
  );
}

const pct = (v: number | null | undefined, fallback: number) => (v != null ? Math.round(v * 10000) / 100 : fallback);

export function ExpectedFields({ initial, projects }: { initial?: Init<"expected_income">; projects: Opt[] }) {
  const r = el.reports;
  return (
    <>
      <Field label={r.expectedSource}>
        <Input name="source" defaultValue={initial?.source} required />
      </Field>
      <div className={two}>
        <Field label={`${r.expectedAmount} (€)`}>
          <Input type="number" step="0.01" min="0" name="amount" defaultValue={initial?.amount} required />
        </Field>
        <Field label={r.expectedMonth}>
          <Input type="month" name="expected_month" defaultValue={initial?.expected_month?.slice(0, 7) ?? ""} required />
        </Field>
      </div>
      <div className={two}>
        <Field label={`${r.probability} %`}>
          <Input type="number" min="0" max="100" step="5" name="probability_pct" defaultValue={pct(initial?.probability, 50)} />
        </Field>
        <Field label={r.scope}>
          <OwnerSelect value={initial?.owner_scope} fallback="corporate" />
        </Field>
      </div>
      <Field label={el.transaction.project}>
        <Pick name="project_id" items={projects} value={initial?.project_id} />
      </Field>
      <Field label={el.netWorth.notes}>
        <Input name="notes" defaultValue={initial?.notes ?? ""} />
      </Field>
    </>
  );
}

export function DealFields({ initial, contacts, projects }: { initial?: Init<"brokerage_deals">; contacts: Opt[]; projects: Opt[] }) {
  const d = el.deals;
  return (
    <>
      <Field label={d.property}>
        <Input name="property_label" defaultValue={initial?.property_label} required />
      </Field>
      <Field label={d.client}>
        <Pick name="client_contact_id" items={contacts} value={initial?.client_contact_id} />
      </Field>
      <div className={two}>
        <Field label={`${d.price} (€)`}>
          <Input type="number" step="0.01" min="0" name="price" defaultValue={initial?.price} required />
        </Field>
        <Field label={d.commissionPct}>
          <Input type="number" step="0.01" min="0" max="100" name="commission_pct" defaultValue={pct(initial?.commission_pct, 2)} />
        </Field>
      </div>
      <Field label={d.commissionOverride}>
        <Input type="number" step="0.01" min="0" name="commission_amount" defaultValue={initial?.commission_amount ?? ""} />
      </Field>
      <div className={two}>
        <Field label={d.stage}>
          <Choices name="stage" values={DEAL_STAGE.filter((s) => s !== "closed")} labels={d.stages} value={initial?.stage} />
        </Field>
        <Field label={d.expectedClose}>
          <Input type="date" name="expected_close_date" defaultValue={initial?.expected_close_date ?? ""} />
        </Field>
      </div>
      <Field label={d.project}>
        <Pick name="project_id" items={projects} value={initial?.project_id} />
      </Field>
      <Field label={d.notes}>
        <Input name="notes" defaultValue={initial?.notes ?? ""} />
      </Field>
    </>
  );
}

export function AccountFields() {
  const a = money.accounts;
  return (
    <>
      <Field label={el.account.name}>
        <Input name="name" required />
      </Field>
      <div className={two}>
        <Field label={el.account.kind}>
          <Choices name="kind" values={ACCOUNT_KIND} labels={a.kinds} />
        </Field>
        <Field label={el.account.ownerScope}>
          <OwnerSelect fallback="corporate" />
        </Field>
      </div>
      <Checkbox name="is_liquid" label={a.isLiquid} defaultChecked />
      <div className={two}>
        <Field label={el.account.openingBalance}>
          <Input type="number" step="0.01" name="opening_balance" defaultValue="0" />
        </Field>
        <Field label={a.openingDate}>
          <Input type="date" name="opening_balance_date" defaultValue={todayAthens()} required />
        </Field>
      </div>
    </>
  );
}

export function CheckFields({ defaultFrom }: { defaultFrom: string }) {
  const a = money.accounts;
  const today = todayAthens();
  return (
    <>
      <Field label={a.asserted}>
        <Input type="number" step="0.01" name="asserted_balance" required autoFocus />
      </Field>
      <div className={two}>
        <Field label={a.asOf}>
          <Input type="date" name="as_of_date" defaultValue={today} max={today} required />
        </Field>
        <Field label={a.periodStart}>
          <Input type="date" name="period_start" defaultValue={defaultFrom} />
        </Field>
      </div>
    </>
  );
}

export function ContactFields({ initial }: { initial?: Init<"contacts"> }) {
  const c = el.contact;
  return (
    <>
      <Field label={c.name}>
        <Input name="name" defaultValue={initial?.name} required />
      </Field>
      <Field label={c.afm}>
        <Input name="afm" defaultValue={initial?.afm ?? ""} pattern="[0-9]{9}" maxLength={9} inputMode="numeric" />
      </Field>
      <div className={two}>
        <Field label={c.phone}>
          <Input name="phone" type="tel" defaultValue={initial?.phone ?? ""} />
        </Field>
        <Field label={c.email}>
          <Input name="email" type="email" defaultValue={initial?.email ?? ""} />
        </Field>
      </div>
    </>
  );
}

export function AssetFields({ initial }: { initial?: Init<"assets"> }) {
  const n = el.netWorth;
  return (
    <>
      <Field label={n.name}>
        <Input name="name" defaultValue={initial?.name} required />
      </Field>
      <div className={two}>
        <Field label={n.category}>
          <Input name="category" defaultValue={initial?.category ?? ""} placeholder={n.categoryHint} />
        </Field>
        <Field label={n.valuationDate}>
          <Input type="date" name="valuation_date" defaultValue={initial?.valuation_date ?? ""} />
        </Field>
      </div>
      <div className={two}>
        <Field label={`${n.value} (€)`}>
          <Input type="number" step="0.01" min="0" name="estimated_value" defaultValue={initial?.estimated_value} required />
        </Field>
        <Field label={n.ownership}>
          <Input type="number" step="0.01" min="0" max="100" name="ownership_pct" defaultValue={pct(initial?.ownership_pct, 100)} />
        </Field>
      </div>
      <div className={two}>
        <Field label={n.owner}>
          <OwnerSelect value={initial?.owner_scope} fallback="personal" />
        </Field>
        <Field label={n.assetState}>
          <Choices name="state" values={ASSET_STATE} labels={n.assetStates} value={initial?.state} />
        </Field>
      </div>
      <Field label={n.notes}>
        <Input name="notes" defaultValue={initial?.notes ?? ""} />
      </Field>
    </>
  );
}

export function LiabilityFields({ initial }: { initial?: Init<"liabilities"> }) {
  const n = el.netWorth;
  return (
    <>
      <div className={two}>
        <Field label={n.lender}>
          <Input name="lender" defaultValue={initial?.lender} required />
        </Field>
        <Field label={n.liabilityKind}>
          <Choices name="kind" values={LIABILITY_KIND} labels={n.liabilityKinds} value={initial?.kind} />
        </Field>
      </div>
      <div className={two}>
        <Field label={`${n.principal} (€)`}>
          <Input type="number" step="0.01" min="0" name="principal" defaultValue={initial?.principal} required />
        </Field>
        <Field label={n.interest}>
          <Input type="number" step="0.01" min="0" max="100" name="interest_pct" defaultValue={pct(initial?.interest_rate, 0)} />
        </Field>
      </div>
      <div className={two}>
        <Field label={n.maturity}>
          <Input type="date" name="maturity_date" defaultValue={initial?.maturity_date ?? ""} />
        </Field>
        <Field label={n.liabilityState}>
          <Choices name="state" values={LIABILITY_STATE} labels={n.liabilityStates} value={initial?.state ?? "disbursed"} />
        </Field>
      </div>
      <div className={two}>
        <Field label={n.owner}>
          <OwnerSelect value={initial?.owner_scope} fallback="personal" />
        </Field>
        <Field label={n.terms}>
          <Input name="terms" defaultValue={initial?.terms ?? ""} />
        </Field>
      </div>
      <p className="text-small text-muted">{n.liabilitiesHint}</p>
    </>
  );
}
