"use client";

import { useActionState } from "react";
import Link from "next/link";
import { Button, Input, Label } from "@/components/ui";

type State = { error?: string | null; message?: string } | undefined;
type Action = (prev: State, formData: FormData) => Promise<State>;

export function AuthForm({
  action,
  mode,
}: {
  action: Action;
  mode: "login" | "signup";
}) {
  const [state, formAction, pending] = useActionState<State, FormData>(
    action,
    undefined,
  );

  return (
    <form action={formAction} className="space-y-4">
      <div>
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" required autoComplete="email" />
      </div>
      <div>
        <Label htmlFor="password">Κωδικός</Label>
        <Input
          id="password"
          name="password"
          type="password"
          required
          autoComplete={mode === "login" ? "current-password" : "new-password"}
        />
      </div>

      {state?.error ? (
        <p className="text-sm text-negative">{state.error}</p>
      ) : null}
      {state?.message ? (
        <p className="text-sm text-positive">{state.message}</p>
      ) : null}

      <Button type="submit" className="w-full" disabled={pending}>
        {pending
          ? "Παρακαλώ περίμενε…"
          : mode === "login"
            ? "Σύνδεση"
            : "Δημιουργία λογαριασμού"}
      </Button>

      <p className="text-center text-sm text-muted">
        {mode === "login" ? (
          <>
            Δεν έχεις λογαριασμό;{" "}
            <Link href="/signup" className="text-primary hover:underline">
              Εγγραφή
            </Link>
          </>
        ) : (
          <>
            Έχεις ήδη λογαριασμό;{" "}
            <Link href="/login" className="text-primary hover:underline">
              Σύνδεση
            </Link>
          </>
        )}
      </p>
    </form>
  );
}
