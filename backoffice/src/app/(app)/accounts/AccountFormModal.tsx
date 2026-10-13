"use client";

import { useId, useState } from "react";
import { Button, Checkbox, Field, FormDrawer, Input, MoneyInput, Select, useToast, type ButtonSize, type ButtonVariant } from "@/components/ui";
import { el } from "@/lib/i18n/el";
import { ACCOUNT_KIND, OWNER_SCOPE, type AccountKind, type OwnerScope } from "@/lib/domain/enums";
import { todayAthens } from "@/lib/dates";
import { amountInputValue } from "@/lib/amountInput";
import { createAccount, updateAccount } from "./actions";

export interface AccountFormValues {
  id: string;
  name: string;
  kind: AccountKind;
  owner_scope: OwnerScope;
  is_liquid: boolean;
  opening_balance: number;
  opening_balance_date: string;
  iban: string | null;
  account_number: string | null;
}

// «Νέος λογαριασμός», or with `account` «Επεξεργασία λογαριασμού» (the same
// form, filled in), in the side drawer. The id travels as a plain prop; the
// actions are imported here, so the server page passes no function.
export function AccountFormModal({
  account,
  variant = account ? "ghost" : "primary",
  size = account ? "sm" : "md",
}: {
  account?: AccountFormValues;
  variant?: ButtonVariant;
  size?: ButtonSize;
}) {
  const [open, setOpen] = useState(false);
  const { show } = useToast();
  const uid = useId();
  const id = (name: string) => `${uid}-${name}`;
  const a = el.account;

  return (
    <>
      <Button variant={variant} size={size} onClick={() => setOpen(true)}>
        {account ? el.common.edit : a.newButton}
      </Button>
      {open && (
        <FormDrawer
          onClose={() => setOpen(false)}
          title={account ? a.editTitle : a.newTitle}
          eyebrow={account?.name}
          action={(formData) => (account ? updateAccount(account.id, formData) : createAccount(formData))}
          onSuccess={() => show(el.common.saved)}
        >
          <Field label={a.name} htmlFor={id("name")} required>
            <Input id={id("name")} name="name" required defaultValue={account?.name} />
          </Field>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label={a.kind} htmlFor={id("kind")}>
              <Select id={id("kind")} name="kind" defaultValue={account?.kind ?? "bank"}>
                {ACCOUNT_KIND.map((k) => (
                  <option key={k} value={k}>
                    {a.kindValues[k]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={a.ownerScope} htmlFor={id("owner")}>
              <Select id={id("owner")} name="owner_scope" defaultValue={account?.owner_scope ?? "corporate"}>
                {OWNER_SCOPE.map((o) => (
                  <option key={o} value={o}>
                    {a.ownerValues[o]}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Checkbox label={a.liquid} name="is_liquid" defaultChecked={account?.is_liquid ?? true} className="self-start pointer-coarse:min-h-11" />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label={a.openingBalance} htmlFor={id("opening")}>
              <MoneyInput
                id={id("opening")}
                name="opening_balance"
                defaultValue={amountInputValue(account?.opening_balance ?? 0)}
                className="w-full"
              />
            </Field>
            <Field label={a.openingDate} htmlFor={id("openingDate")} required>
              <Input
                id={id("openingDate")}
                type="date"
                name="opening_balance_date"
                defaultValue={account?.opening_balance_date ?? todayAthens()}
                required
              />
            </Field>
          </div>
          <Field label={a.iban} htmlFor={id("iban")}>
            <Input id={id("iban")} name="iban" autoComplete="off" spellCheck={false} placeholder="GR.." defaultValue={account?.iban ?? ""} />
          </Field>
          <Field label={a.accountNumber} hint={a.statementHint} htmlFor={id("number")}>
            <Input id={id("number")} name="account_number" inputMode="numeric" autoComplete="off" defaultValue={account?.account_number ?? ""} />
          </Field>
        </FormDrawer>
      )}
    </>
  );
}
