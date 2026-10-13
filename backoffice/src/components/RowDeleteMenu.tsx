"use client";

import type { MouseEvent, ReactNode } from "react";
import { ActionForm } from "@/components/ActionForm";
import { Button } from "@/components/ui";
import type { ActionResult } from "@/lib/actions";

// A row's delete, shown as a visible button on the row (as on 7 Oct) rather
// than inside a «⋯» menu: one click, then a browser confirm. The same form
// (ActionForm, or a plain <form> with `plain`) and server action as before;
// any error shows under the button, and on success the row is gone. `label`
// is kept as the accessible name prefix so callers need no change.
export function RowDeleteMenu({
  action,
  label,
  children,
  title,
  plain = false,
}: {
  action: (formData: FormData) => Promise<ActionResult<unknown> | void>;
  label: string;
  children: ReactNode;
  title?: string;
  plain?: boolean;
}) {
  const what = typeof children === "string" ? children : label;
  function confirmFirst(e: MouseEvent<HTMLButtonElement>) {
    if (!window.confirm(`${what}; Δεν αναιρείται.`)) e.preventDefault();
  }
  const button = (
    <Button type="submit" variant="ghost" size="sm" title={title} onClick={confirmFirst} className="text-negative hover:text-negative">
      {children}
    </Button>
  );
  return plain ? (
    // A plain form ignores the result, as the row's own form did.
    <form action={action as (formData: FormData) => Promise<void>}>{button}</form>
  ) : (
    <ActionForm action={action}>{button}</ActionForm>
  );
}
