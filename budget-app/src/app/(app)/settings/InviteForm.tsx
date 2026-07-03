"use client";

import { useActionState } from "react";
import { Button, Input, Label } from "@/components/ui";
import { inviteCollaborator } from "./actions";

type State = { error?: string | null; message?: string } | undefined;

export function InviteForm() {
  const [state, formAction, pending] = useActionState<State, FormData>(
    inviteCollaborator,
    undefined,
  );

  return (
    <form action={formAction} className="space-y-3">
      <div>
        <Label htmlFor="email">Email συνεργάτη</Label>
        <Input id="email" name="email" type="email" required placeholder="name@example.com" />
      </div>
      {state?.error ? (
        <p className="text-sm text-negative">{state.error}</p>
      ) : null}
      {state?.message ? (
        <p className="rounded-lg bg-green-50 p-2 text-sm text-positive">
          {state.message}
        </p>
      ) : null}
      <Button type="submit" disabled={pending}>
        {pending ? "Προσθήκη…" : "Πρόσκληση στο κοινό budget"}
      </Button>
    </form>
  );
}
