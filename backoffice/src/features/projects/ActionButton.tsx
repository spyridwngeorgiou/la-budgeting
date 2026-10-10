"use client";

import type { ReactNode } from "react";
import { Button, type ButtonVariant } from "@/components/ui";
import { useAction } from "@/lib/useAction";
import type { ActionResult } from "@/lib/actions";

// One click, one server action (Ορισμός ως βάση, Διαγραφή, Επίλυση …), with
// the action's { error } shown next to the button instead of lost.
export function ActionButton({
  action,
  children,
  variant = "ghost",
  confirm,
  fields,
}: {
  action: (formData: FormData) => Promise<ActionResult<unknown> | void>;
  children: ReactNode;
  variant?: ButtonVariant;
  // Asked before running (deletes).
  confirm?: string;
  // Extra form controls rendered before the button (send-to-cash horizon …).
  fields?: ReactNode;
}) {
  const { formAction, error, pending } = useAction(action);
  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
      className="inline-flex flex-wrap items-end gap-2"
    >
      {fields}
      <Button type="submit" variant={variant} size={fields ? "md" : "sm"} disabled={pending}>
        {children}
      </Button>
      {error && (
        <p role="alert" className="basis-full border-l-2 border-negative pl-2 text-small text-negative">
          {error}
        </p>
      )}
    </form>
  );
}
