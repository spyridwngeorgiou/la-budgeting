"use client";

import { startTransition, useActionState } from "react";
import { Button, Select } from "@/components/ui";
import { uploadBankStatement, type InboxResult } from "./actions";

// The one drop zone. Today it takes bank statements (CSV / XLSX); AADE,
// AI documents and cash move here as their adapters land (Stage 4 roll-out).
export function UploadForm({ accounts }: { accounts: { id: string; label: string }[] }) {
  const [state, action, pending] = useActionState<InboxResult | null, FormData>(
    (_prev, formData) => uploadBankStatement(formData),
    null,
  );
  return (
    // onSubmit + startTransition rather than action={...}: an action form
    // is reset when the action returns, which would throw away the user's
    // choices whenever the server answers with an error.
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const formData = new FormData(e.currentTarget);
        startTransition(() => action(formData));
      }}
      className="flex flex-col gap-2 rounded-lg border border-line p-4"
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <input type="file" name="file" accept=".csv,.txt,.xlsx" required className="min-w-0 text-sm" />
        <Select name="account_id" required defaultValue="" className="sm:w-64">
          <option value="" disabled>
            Λογαριασμός αντιγράφου…
          </option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.label}
            </option>
          ))}
        </Select>
        <Button type="submit" disabled={pending}>
          {pending ? "Ανάγνωση…" : "Ανέβασμα αντιγράφου κίνησης"}
        </Button>
      </div>
      <p className="text-xs text-ink-muted">
        CSV ή XLSX από το e-banking. Τα παλιά .xls: ανοίξτε τα στο Excel και αποθηκεύστε ως .xlsx.
      </p>
      {state && "error" in state && <p className="text-sm text-red-ink">{state.error}</p>}
    </form>
  );
}
