"use client";

import { useActionState } from "react";
import { isFailure, type ActionResult } from "./actions";

type Result<T> = ActionResult<T> | void | null | undefined;

// React 19 useActionState around a server action that returns ActionResult.
//   const { formAction, error, pending } = useAction(saveThing, { onSuccess: close });
//   <form action={formAction}> … {error && <p>{error}</p>}
// A thrown error (redirect/notFound aside) is also caught and shown, so an
// action not yet converted to ActionResult still surfaces something.
export function useAction<T>(
  fn: (formData: FormData) => Promise<Result<T>>,
  opts: { onSuccess?: (data: T | undefined) => void } = {},
) {
  const [state, formAction, pending] = useActionState<Result<T>, FormData>(async (_prev, formData) => {
    let result: Result<T>;
    try {
      result = await fn(formData);
    } catch (e) {
      return { error: e instanceof Error && e.message ? e.message : "Σφάλμα" };
    }
    if (!isFailure(result)) opts.onSuccess?.(result && "data" in result ? result.data : undefined);
    return result;
  }, null);
  return { state, formAction, pending, error: isFailure(state) ? state.error : null };
}
