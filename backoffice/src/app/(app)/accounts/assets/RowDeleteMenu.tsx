"use client";

import type { MouseEvent } from "react";
import { ArgsActionForm } from "@/components/ArgsActionForm";
import { Button, useConfirm } from "@/components/ui";
import { el } from "@/lib/i18n/el";
import type { ActionResult } from "@/lib/actions";

// The row's delete as a visible button (one click, then the app's
// «Είστε σίγουροι;» dialog), with the same ArgsActionForm the row used. The
// row leaves the list when the action revalidates; an error shows under the
// button.
export function RowDeleteMenu({ action, id }: { action: (id: string) => Promise<ActionResult>; id: string }) {
  const { confirm, dialog } = useConfirm();
  async function confirmFirst(e: MouseEvent<HTMLButtonElement>) {
    const form = e.currentTarget.form;
    e.preventDefault();
    if (form && (await confirm({ message: `${el.common.delete}; Δεν αναιρείται.` }))) form.requestSubmit();
  }
  return (
    <>
      <ArgsActionForm action={action} args={[id]}>
        <Button type="submit" variant="ghost" size="sm" onClick={confirmFirst} className="text-negative hover:text-negative">
          {el.common.delete}
        </Button>
      </ArgsActionForm>
      {dialog}
    </>
  );
}
