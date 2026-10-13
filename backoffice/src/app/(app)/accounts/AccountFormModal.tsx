"use client";

import { useState } from "react";
import { Button, Input, Select, Label, Field, Modal, Notice, type ButtonSize, type ButtonVariant } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";
import { el } from "@/lib/i18n/el";
import { ACCOUNT_KIND, OWNER_SCOPE, type AccountKind, type OwnerScope } from "@/lib/domain/enums";
import { todayAthens } from "@/lib/dates";
import { errorOf } from "@/lib/actions";
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

// New account, or with `account` the same form filled in for editing
// (updateAccount). The id travels as a plain prop; the actions are imported
// here, so the server page passes no function.
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
  const [error, setError] = useState<string | null>(null);

  return (
    <>
      <Button variant={variant} size={size} onClick={() => setOpen(true)}>
        {account ? el.common.edit : "+ Νέος Λογαριασμός"}
      </Button>
      {open && (
        <Modal
          onClose={() => setOpen(false)}
          className="max-h-[90dvh] w-[calc(100%-2rem)] max-w-md overflow-y-auto border border-hairline bg-raised p-5 md:p-6"
          closeOnBackdrop={false}
        >
          <form
            action={async (formData) => {
              setError(null);
              const result = account ? await updateAccount(account.id, formData) : await createAccount(formData);
              const message = errorOf(result);
              if (message) return setError(message);
              setOpen(false);
            }}
            className="flex flex-col gap-4"
          >
            {account && <p className="eyebrow text-muted">{el.common.edit} · {account.name}</p>}
            <Field>
              <Label>{el.account.name}</Label>
              <Input name="name" required defaultValue={account?.name} />
            </Field>
            <Field>
              <Label>{el.account.kind}</Label>
              <Select name="kind" defaultValue={account?.kind ?? "bank"}>
                {ACCOUNT_KIND.map((k) => (
                  <option key={k} value={k}>
                    {el.account.kindValues[k]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field>
              <Label>{el.account.ownerScope}</Label>
              <Select name="owner_scope" defaultValue={account?.owner_scope ?? "corporate"}>
                {OWNER_SCOPE.map((o) => (
                  <option key={o} value={o}>
                    {el.account.ownerValues[o]}
                  </option>
                ))}
              </Select>
            </Field>
            <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 self-start text-body text-ink md:min-h-10">
              <input type="checkbox" name="is_liquid" defaultChecked={account?.is_liquid ?? true} className="h-4 w-4 accent-navy" />
              Ρευστό διαθέσιμο
            </label>
            <Field>
              <Label>{el.account.openingBalance}</Label>
              <Input type="number" step="0.01" name="opening_balance" defaultValue={String(account?.opening_balance ?? 0)} />
            </Field>
            <Field>
              <Label>{el.account.iban}</Label>
              <Input name="iban" autoComplete="off" spellCheck={false} placeholder="GR.." defaultValue={account?.iban ?? ""} />
            </Field>
            <Field>
              <Label>{el.account.accountNumber}</Label>
              <Input name="account_number" inputMode="numeric" autoComplete="off" defaultValue={account?.account_number ?? ""} />
              <p className="text-small text-muted">{el.account.statementHint}</p>
            </Field>
            <Field>
              <Label>Ημ/νία Υπολοίπου Έναρξης</Label>
              <Input
                type="date"
                name="opening_balance_date"
                defaultValue={account?.opening_balance_date ?? todayAthens()}
                required
              />
            </Field>
            {error && (
              <Notice tone="negative" role="alert">
                {error}
              </Notice>
            )}
            <div className="mt-2 flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
                {el.common.cancel}
              </Button>
              <SubmitButton>{el.common.save}</SubmitButton>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
