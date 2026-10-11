"use client";

import { ArgsActionForm } from "@/components/ArgsActionForm";
import { Menu, MenuItem } from "@/components/ui";
import { el } from "@/lib/i18n/el";
import { shell } from "@/lib/i18n/v2/shell";
import type { ActionResult } from "@/lib/actions";

// The row's «⋯» menu holding its delete (the same ArgsActionForm the row's
// own button used). The item keeps its click from reaching the menu: the
// menu closes by unmounting, which would take the form out of the page
// before the browser submits it. The row leaves the list when the action
// revalidates; an error shows in the still-open menu.
export function RowDeleteMenu({ action, id }: { action: (id: string) => Promise<ActionResult>; id: string }) {
  return (
    <Menu label={shell.ui.actions}>
      <ArgsActionForm action={action} args={[id]}>
        <MenuItem type="submit" tone="danger" onClick={(e) => e.stopPropagation()}>
          {el.common.delete}
        </MenuItem>
      </ArgsActionForm>
    </Menu>
  );
}
