"use client";

import { useState } from "react";
import { Input, Label, Field } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";
import { changePassword } from "./actions";

export function ChangePasswordForm() {
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  return (
    <form
      action={async (formData) => {
        setError(null);
        setSuccess(false);
        try {
          await changePassword(formData);
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
      {error && <p className="text-sm text-red-ink">{error}</p>}
      {success && <p className="text-sm text-sage-ink">Ο κωδικός άλλαξε επιτυχώς.</p>}
      <div className="flex justify-end">
        <SubmitButton>Αλλαγή Κωδικού</SubmitButton>
      </div>
    </form>
  );
}
