"use client";

import type { MouseEvent } from "react";
import { ArgsActionForm } from "@/components/ArgsActionForm";
import { Button, useConfirm } from "@/components/ui";
import { el } from "@/lib/i18n/el";
import { setExpectedIncomeStatus } from "./actions";

// «Δεν θα έρθει» (status → cancelled) asks first, with the app's «Είστε
// σίγουροι;» dialog: the row leaves the list and the cash forecast. The
// same ArgsActionForm as before (id and status as plain args, no .bind);
// an error shows under the button.
export function CancelExpectedButton({ id, source }: { id: string; source: string }) {
  const { confirm, dialog } = useConfirm();
  async function confirmFirst(e: MouseEvent<HTMLButtonElement>) {
    // The form is read before the await: the event is gone after it.
    const form = e.currentTarget.form;
    e.preventDefault();
    const ok = await confirm({
      message: el.reports.expectedCancelConfirm.replace("{source}", source),
      confirmLabel: el.reports.expectedCancel,
    });
    if (ok && form) form.requestSubmit();
  }
  return (
    <>
      <ArgsActionForm action={setExpectedIncomeStatus} args={[id, "cancelled"]}>
        <Button type="submit" variant="ghost" size="sm" onClick={confirmFirst}>
          {el.reports.expectedCancel}
        </Button>
      </ArgsActionForm>
      {dialog}
    </>
  );
}
