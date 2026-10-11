"use client";

import type { ReactNode } from "react";
import type { ActionResult } from "@/lib/actions";
import { useAction } from "@/lib/useAction";

// ActionForm for a list row, without `action.bind(null, id)` per row (Next
// encrypts every bound argument, which costs CPU on every render). The
// server page passes the plain server action and its leading arguments as
// plain values; on submit this calls action(...args, formData). An action
// that takes no FormData simply ignores the last argument.
//
//   <ArgsActionForm action={setStatus} args={[row.id, "received"]}>…</ArgsActionForm>
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyAction = (...args: any[]) => Promise<ActionResult<unknown> | void>;

export function ArgsActionForm({
  action,
  args,
  children,
  className,
}: {
  action: AnyAction;
  args: (string | number | boolean | null)[];
  children: ReactNode;
  className?: string;
}) {
  const { formAction, error } = useAction((formData: FormData) => action(...args, formData));
  return (
    <form action={formAction} className={className}>
      {children}
      {error && (
        <p role="alert" className="basis-full border-l-2 border-negative pl-3 text-sm text-negative">
          {error}
        </p>
      )}
    </form>
  );
}
