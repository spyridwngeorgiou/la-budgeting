"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, FormDrawer, LINK_CLASS, type ButtonSize, type ButtonVariant } from "@/components/ui";
import { el } from "@/lib/i18n/el";
import { assertAccountBalance } from "./actions";
import { BalanceAssertion, type BalanceCheck } from "./BalanceAssertion";
import { NewCheckFields } from "./NewCheckModal";

// «Έλεγχος υπολοίπου»: the new-check form (assertAccountBalance) in a side
// drawer. On the account page the check history sits under it (`checks`);
// on the list (no `checks`) a link leads to that history instead. The id
// travels as a plain prop -- no bound action, so a list of rows stays cheap.
export function CheckDrawer({
  accountId,
  accountName,
  isCash,
  expectedToday,
  defaultFrom,
  checks,
  label = el.account.checkBalance,
  variant,
  size = "md",
}: {
  accountId: string;
  accountName: string;
  isCash: boolean;
  expectedToday: number;
  defaultFrom: string;
  checks?: BalanceCheck[];
  label?: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
}) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  return (
    <>
      <Button
        type="button"
        size={size}
        variant={variant ?? (checks && checks.length > 0 ? "secondary" : "primary")}
        onClick={() => setOpen(true)}
      >
        {label}
      </Button>
      {open && (
        <FormDrawer
          onClose={() => setOpen(false)}
          eyebrow={accountName}
          title={el.account.checkBalance}
          submitLabel={el.account.checkSubmit}
          action={(formData) => assertAccountBalance(accountId, formData)}
          // The action revalidates /accounts; the account page refreshes itself.
          onSuccess={() => router.refresh()}
        >
          <NewCheckFields expectedToday={expectedToday} defaultFrom={defaultFrom} />
          <section className="mt-4 flex flex-col gap-3 border-t border-rule pt-4">
            <h3 className="eyebrow text-muted">{el.account.checkHistory}</h3>
            {checks ? (
              <BalanceAssertion accountId={accountId} checks={checks} isCash={isCash} />
            ) : (
              <Link href={`/accounts/${accountId}`} className={`text-body ${LINK_CLASS}`}>
                {el.account.checkHistory} →
              </Link>
            )}
          </section>
        </FormDrawer>
      )}
    </>
  );
}
