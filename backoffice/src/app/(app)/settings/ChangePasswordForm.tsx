"use client";

import { useState } from "react";
import { Field, Input, Label, Notice } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";
import { changePassword } from "./actions";
import { errorOf } from "@/lib/actions";

export function ChangePasswordForm() {
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  return (
    <form
      action={async (formData) => {
        setError(null);
        setSuccess(false);
        try {
          const message = errorOf(await changePassword(formData));
          if (message) return setError(message);
          setSuccess(true);
          (document.getElementById("change-password-form") as HTMLFormElement | null)?.reset();
        } catch (e) {
          setError(e instanceof Error ? e.message : "Σφάλμα.");
        }
      }}
      id="change-password-form"
      className="flex flex-col gap-3"
    >
      <Field>
        <Label>Νέος Κωδικός</Label>
        <Input type="password" name="new_password" minLength={8} required autoComplete="new-password" />
      </Field>
      <Field>
        <Label>Επιβεβαίωση Κωδικού</Label>
        <Input type="password" name="confirm_password" minLength={8} required autoComplete="new-password" />
      </Field>
      {error && (
        <Notice tone="negative" role="alert">
          {error}
        </Notice>
      )}
      {success && <Notice tone="positive">Ο κωδικός άλλαξε επιτυχώς.</Notice>}
      <div className="flex justify-end">
        <SubmitButton>Αλλαγή Κωδικού</SubmitButton>
      </div>
    </form>
  );
}
