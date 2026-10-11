"use client";

import type { ReactNode } from "react";
import { ActionForm } from "@/components/ActionForm";
import { Menu, MenuItem } from "@/components/ui";
import type { ActionResult } from "@/lib/actions";

// A row's «⋯» menu holding its delete: the same form (ActionForm, or a plain
// <form> with `plain`) and server action the row's delete button had. The click does not bubble to the
// menu, so the menu stays open (and the form mounted) while the form
// submits; any error shows under the item, and on success the row is gone.
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
  const item = (
    <MenuItem type="submit" tone="danger" title={title} onClick={(e) => e.stopPropagation()}>
      {children}
    </MenuItem>
  );
  return (
    <Menu label={label}>
      {plain ? (
        // A plain form ignores the result, as the row's own form did.
        <form action={action as (formData: FormData) => Promise<void>}>{item}</form>
      ) : (
        <ActionForm action={action}>{item}</ActionForm>
      )}
    </Menu>
  );
}
