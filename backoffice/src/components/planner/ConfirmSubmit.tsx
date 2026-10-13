"use client";

import type { MouseEvent, ReactNode } from "react";
import { SubmitButton } from "@/components/SubmitButton";
import { useConfirm, useToast } from "@/components/ui";
import { errorOf } from "@/lib/actions";

// A form whose submit asks first -- for the irreversible delete. The app's
// own «Είστε σίγουροι;» dialog, then the same form submits (so the button
// still shows the pending state); a refusal from the server is a toast.
export function ConfirmSubmit({
  action,
  confirmText,
  children,
}: {
  action: () => Promise<unknown>;
  confirmText: string;
  children: ReactNode;
}) {
  const { confirm, dialog } = useConfirm();
  const { show } = useToast();

  async function confirmFirst(e: MouseEvent<HTMLButtonElement>) {
    // The form is read before the await: the event is gone after it.
    const form = e.currentTarget.form;
    e.preventDefault();
    const label = typeof children === "string" ? children : undefined;
    if (form && (await confirm({ message: confirmText, confirmLabel: label }))) form.requestSubmit();
  }

  return (
    <>
      <form
        action={async () => {
          const message = errorOf(await action());
          if (message) show(message, { tone: "negative" });
        }}
      >
        <SubmitButton variant="danger" onClick={confirmFirst}>
          {children}
        </SubmitButton>
      </form>
      {dialog}
    </>
  );
}
