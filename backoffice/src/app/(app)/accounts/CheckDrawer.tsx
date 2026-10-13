"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, FormDrawer, LINK_CLASS, useToast, type ButtonSize, type ButtonVariant } from "@/components/ui";
import { el } from "@/lib/i18n/el";
import { assertAccountBalance } from "./actions";
import { NewCheckFields } from "./NewCheckModal";

// «Νέος έλεγχος»: the new-check form (assertAccountBalance) in a side
// drawer. The check history lives on the account page («Έλεγχοι
// υπολοίπου»); from the list (`historyLink`) the drawer links there. The id
// travels as a plain prop -- no bound action, so a list of rows stays cheap.
export function CheckDrawer({
  accountId,
  accountName,
  expectedToday,
  defaultFrom,
  historyLink = false,
  label = el.account.newCheck,
  variant = "primary",
  size = "md",
}: {
  accountId: string;
  accountName: string;
  expectedToday: number;
  defaultFrom: string;
  historyLink?: boolean;
  label?: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
}) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const { show } = useToast();
  return (
    <>
      <Button type="button" size={size} variant={variant} onClick={() => setOpen(true)}>
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
          onSuccess={() => {
            show(el.common.saved);
            router.refresh();
          }}
        >
          <NewCheckFields expectedToday={expectedToday} defaultFrom={defaultFrom} />
          {historyLink && (
            <Link href={`/accounts/${accountId}`} className={`mt-2 self-start text-body ${LINK_CLASS}`}>
              {el.account.checkHistory} →
            </Link>
          )}
        </FormDrawer>
      )}
    </>
  );
}
