"use client";

import type { ReactNode } from "react";
import type { ActionResult } from "@/lib/actions";
import { useAction } from "@/lib/useAction";
import { Notice } from "@/components/ui";

// A <form> for server components whose server action returns ActionResult:
// the server page passes the action (bound or not) and its fields as
// children, this shows the returned { error } under them.
export function ActionForm({
  action,
  children,
  className,
}: {
  action: (formData: FormData) => Promise<ActionResult<unknown> | void>;
  children: ReactNode;
  className?: string;
}) {
  const { formAction, error } = useAction(action);
  return (
    <form action={formAction} className={className}>
      {children}
      {error && (
        <Notice tone="negative" role="alert" className="basis-full">
          {error}
        </Notice>
      )}
    </form>
  );
}
