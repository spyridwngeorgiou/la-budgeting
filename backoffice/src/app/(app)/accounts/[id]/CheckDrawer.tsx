"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, FormDrawer } from "@/components/ui";
import { el } from "@/lib/i18n/el";
import { assertAccountBalance } from "../actions";
import { BalanceAssertion, type BalanceCheck } from "../BalanceAssertion";
import { NewCheckFields } from "../NewCheckModal";

// «Έλεγχος υπολοίπου»: the new-check form (assertAccountBalance) with the
// account's check history under it, in a side drawer. One account per page,
// so the id travels as a plain prop -- no bound action.
export function CheckDrawer({
  accountId,
  accountName,
  isCash,
  expectedToday,
  defaultFrom,
  checks,
}: {
  accountId: string;
  accountName: string;
  isCash: boolean;
  expectedToday: number;
  defaultFrom: string;
  checks: BalanceCheck[];
}) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  return (
    <>
      <Button type="button" variant={checks.length > 0 ? "secondary" : "primary"} onClick={() => setOpen(true)}>
        {el.account.checkBalance}
      </Button>
      {open && (
        <FormDrawer
          onClose={() => setOpen(false)}
          eyebrow={accountName}
          title={el.account.checkBalance}
          submitLabel={el.account.checkSubmit}
          action={(formData) => assertAccountBalance(accountId, formData)}
          // The action revalidates /accounts; this page refreshes itself.
          onSuccess={() => router.refresh()}
        >
          <NewCheckFields expectedToday={expectedToday} defaultFrom={defaultFrom} />
          <section className="mt-4 flex flex-col gap-3 border-t border-rule pt-4">
            <h3 className="eyebrow text-muted">{el.account.checkHistory}</h3>
            <BalanceAssertion accountId={accountId} checks={checks} isCash={isCash} />
          </section>
        </FormDrawer>
      )}
    </>
  );
}
