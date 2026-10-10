"use client";

import { useState } from "react";
import { Button, Field, Input, Label, Select } from "@/components/ui";
import { FormModal } from "@/components/Modal";
import { el } from "@/lib/i18n/el";
import { ASSET_STATE, LIABILITY_KIND, LIABILITY_STATE } from "@/lib/domain/enums";
import type { ActionResult } from "@/lib/actions";

type Action = (formData: FormData) => Promise<ActionResult>;

function OwnerSelect({ value }: { value?: string }) {
  return (
    <Field>
      <Label>{el.netWorth.owner}</Label>
      <Select name="owner_scope" defaultValue={value ?? "personal"}>
        <option value="personal">{el.account.ownerValues.personal}</option>
        <option value="corporate">{el.account.ownerValues.corporate}</option>
      </Select>
    </Field>
  );
}

function Trigger({ edit, label, onClick }: { edit: boolean; label: string; onClick: () => void }) {
  return (
    <Button variant="secondary" className="!px-2 !py-1 text-xs" onClick={onClick}>
      {edit ? el.common.edit : `+ ${label}`}
    </Button>
  );
}

export interface AssetInitial {
  name: string;
  category: string | null;
  estimated_value: number;
  ownership_pct: number; // fraction
  owner_scope: string;
  state: string;
  valuation_date: string | null;
  notes: string | null;
}

export function AssetFormModal({ action, initial }: { action: Action; initial?: AssetInitial }) {
  const [open, setOpen] = useState(false);
  const t = el.netWorth;
  return (
    <>
      <Trigger edit={!!initial} label={t.addAsset} onClick={() => setOpen(true)} />
      {open && (
        <FormModal onClose={() => setOpen(false)} title={initial ? t.editAsset : t.addAsset} action={action}>
          <Field>
            <Label>{t.name}</Label>
            <Input name="name" defaultValue={initial?.name} required />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field>
              <Label>{t.category}</Label>
              <Input name="category" defaultValue={initial?.category ?? ""} placeholder={t.categoryHint} />
            </Field>
            <Field>
              <Label>{t.valuationDate}</Label>
              <Input type="date" name="valuation_date" defaultValue={initial?.valuation_date ?? ""} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field>
              <Label>{t.value} (€)</Label>
              <Input type="number" step="0.01" min="0" name="estimated_value" defaultValue={initial?.estimated_value} required />
            </Field>
            <Field>
              <Label>{t.ownership}</Label>
              <Input
                type="number"
                step="0.01"
                min="0"
                max="100"
                name="ownership_pct"
                defaultValue={initial ? Math.round(initial.ownership_pct * 10000) / 100 : 100}
              />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <OwnerSelect value={initial?.owner_scope} />
            <Field>
              <Label>{t.assetState}</Label>
              <Select name="state" defaultValue={initial?.state ?? "held"}>
                {ASSET_STATE.map((s) => (
                  <option key={s} value={s}>
                    {t.assetStates[s]}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Field>
            <Label>{t.notes}</Label>
            <Input name="notes" defaultValue={initial?.notes ?? ""} />
          </Field>
        </FormModal>
      )}
    </>
  );
}

export interface LiabilityInitial {
  lender: string;
  kind: string;
  principal: number;
  interest_rate: number; // fraction
  maturity_date: string | null;
  state: string;
  owner_scope: string;
  terms: string | null;
}

export function LiabilityFormModal({ action, initial }: { action: Action; initial?: LiabilityInitial }) {
  const [open, setOpen] = useState(false);
  const t = el.netWorth;
  return (
    <>
      <Trigger edit={!!initial} label={t.addLiability} onClick={() => setOpen(true)} />
      {open && (
        <FormModal onClose={() => setOpen(false)} title={initial ? t.editLiability : t.addLiability} action={action}>
          <div className="grid grid-cols-2 gap-3">
            <Field>
              <Label>{t.lender}</Label>
              <Input name="lender" defaultValue={initial?.lender} required />
            </Field>
            <Field>
              <Label>{t.liabilityKind}</Label>
              <Select name="kind" defaultValue={initial?.kind ?? "private"}>
                {LIABILITY_KIND.map((k) => (
                  <option key={k} value={k}>
                    {t.liabilityKinds[k]}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field>
              <Label>{t.principal} (€)</Label>
              <Input type="number" step="0.01" min="0" name="principal" defaultValue={initial?.principal} required />
            </Field>
            <Field>
              <Label>{t.interest}</Label>
              <Input
                type="number"
                step="0.001"
                min="0"
                max="100"
                name="interest_pct"
                defaultValue={initial ? Math.round(initial.interest_rate * 100000) / 1000 : 0}
              />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field>
              <Label>{t.maturity}</Label>
              <Input type="date" name="maturity_date" defaultValue={initial?.maturity_date ?? ""} />
            </Field>
            <Field>
              <Label>{t.liabilityState}</Label>
              <Select name="state" defaultValue={initial?.state ?? "disbursed"}>
                {LIABILITY_STATE.map((s) => (
                  <option key={s} value={s}>
                    {t.liabilityStates[s]}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <OwnerSelect value={initial?.owner_scope} />
          <Field>
            <Label>{t.terms}</Label>
            <Input name="terms" defaultValue={initial?.terms ?? ""} />
          </Field>
        </FormModal>
      )}
    </>
  );
}
