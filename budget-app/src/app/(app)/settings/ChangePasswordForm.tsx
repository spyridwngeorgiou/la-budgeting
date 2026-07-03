"use client";

import { useActionState } from "react";
import { Button, Input, Label } from "@/components/ui";
import { updatePassword } from "@/app/(auth)/actions";

type State = { error?: string | null; message?: string } | undefined;

export function ChangePasswordForm() {
  const [state, formAction, pending] = useActionState<State, FormData>(
    updatePassword,
    undefined,
  );

  return (
    <form action={formAction} className="max-w-sm space-y-4">
      <div>
        <Label htmlFor="password">Νέος κωδικός</Label>
        <Input
          id="password"
          name="password"
          type="password"
          required
          autoComplete="new-password"
        />
      </div>
      <div>
        <Label htmlFor="confirm">Επιβεβαίωση κωδικού</Label>
        <Input
          id="confirm"
          name="confirm"
          type="password"
          required
          autoComplete="new-password"
        />
      </div>

      {state?.error ? (
        <p className="text-sm text-negative">{state.error}</p>
      ) : null}
      {state?.message ? (
        <p className="text-sm text-positive">{state.message}</p>
      ) : null}

      <Button type="submit" disabled={pending}>
        {pending ? "Αποθήκευση…" : "Αλλαγή κωδικού"}
      </Button>
    </form>
  );
}
