"use client";

import { startTransition, useActionState, useState } from "react";
import { Button, Field, Input, Label, Select } from "@/components/ui";
import type { ProfileField } from "@/lib/ingest/profiles/types";
import { saveMappingAndStage, type InboxResult } from "../../actions";

const FIELD_LABELS: { field: ProfileField; label: string; for?: "debit_credit" | "direction_column" | "amount" }[] = [
  { field: "date", label: "Ημερομηνία *" },
  { field: "value_date", label: "Ημερομηνία αξίας" },
  { field: "description", label: "Περιγραφή" },
  { field: "amount", label: "Ποσό *", for: "amount" },
  { field: "debit", label: "Χρέωση *", for: "debit_credit" },
  { field: "credit", label: "Πίστωση *", for: "debit_credit" },
  { field: "direction", label: "Πρόσημο (Χ/Π) *", for: "direction_column" },
  { field: "balance", label: "Υπόλοιπο" },
  { field: "reference", label: "Αρ. συναλλαγής / αναφορά" },
  { field: "counterparty", label: "Αντισυμβαλλόμενος" },
  { field: "counterparty_iban", label: "IBAN αντισυμβαλλόμενου" },
];

export function MappingForm({
  batchId,
  preview,
  width,
  initialHeaderRow,
  initialColumns,
  defaultName,
}: {
  batchId: string;
  preview: string[][];
  width: number;
  initialHeaderRow: number;
  initialColumns: Record<string, number>;
  defaultName: string;
}) {
  const [headerRow, setHeaderRow] = useState(initialHeaderRow);
  const [signMode, setSignMode] = useState(
    initialColumns.debit !== undefined && initialColumns.credit !== undefined ? "debit_credit" : "signed",
  );
  const [state, action, pending] = useActionState<InboxResult | null, FormData>(
    (_prev, formData) => saveMappingAndStage(batchId, formData),
    null,
  );
  const header = preview[headerRow - 1] ?? [];
  const columnLabel = (i: number) => `${i + 1}. ${header[i]?.trim() || "—"}`;
  const visible = FIELD_LABELS.filter(
    (f) =>
      !f.for ||
      (f.for === "debit_credit" && signMode === "debit_credit") ||
      (f.for === "direction_column" && signMode === "direction_column") ||
      (f.for === "amount" && signMode !== "debit_credit"),
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
      className="flex flex-col gap-4"
    >
      <div className="max-h-80 overflow-auto rounded-lg border border-line">
        <table className="text-xs">
          <tbody>
            {preview.map((row, r) => (
              <tr
                key={r}
                onClick={() => setHeaderRow(r + 1)}
                className={`cursor-pointer border-t border-line ${r + 1 === headerRow ? "bg-sage font-semibold" : r + 1 < headerRow ? "text-ink-faint" : ""}`}
              >
                <td className="px-2 py-1 text-ink-muted">{r + 1}</td>
                {Array.from({ length: width }, (_, c) => (
                  <td key={c} className="max-w-56 truncate px-2 py-1 whitespace-nowrap">
                    {row[c] ?? ""}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-ink-muted">Πατήστε τη γραμμή της επικεφαλίδας (τώρα: γραμμή {headerRow}).</p>
      <input type="hidden" name="header_row" value={headerRow} />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field>
          <Label>Πρόσημο ποσών</Label>
          <Select name="sign_mode" value={signMode} onChange={(e) => setSignMode(e.target.value)}>
            <option value="signed">Μία στήλη, αρνητικό = χρέωση (και «1.234,56-»)</option>
            <option value="debit_credit">Ξεχωριστές στήλες Χρέωση / Πίστωση</option>
            <option value="direction_column">Ποσό + στήλη Χ/Π</option>
          </Select>
        </Field>
        <Field>
          <Label>Μορφή ημερομηνίας</Label>
          <Select name="date_format" defaultValue="dd/MM/yyyy">
            <option value="dd/MM/yyyy">ηη/μμ/εεεε</option>
            <option value="dd/MM/yy">ηη/μμ/εε</option>
            <option value="yyyy-MM-dd">εεεε-μμ-ηη</option>
            <option value="MM/dd/yyyy">μμ/ηη/εεεε</option>
          </Select>
        </Field>
        <Field>
          <Label>Υποδιαστολή</Label>
          <Select name="decimal_separator" defaultValue=",">
            <option value=",">κόμμα (1.234,56)</option>
            <option value=".">τελεία (1,234.56)</option>
          </Select>
        </Field>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {visible.map((f) => (
          <Field key={f.field}>
            <Label>{f.label}</Label>
            <Select name={`col_${f.field}`} defaultValue={initialColumns[f.field]?.toString() ?? ""}>
              <option value="">—</option>
              {Array.from({ length: width }, (_, i) => (
                <option key={i} value={i}>
                  {columnLabel(i)}
                </option>
              ))}
            </Select>
          </Field>
        ))}
        {signMode === "direction_column" && (
          <Field>
            <Label>Τιμές που σημαίνουν χρέωση</Label>
            <Input name="debit_markers" defaultValue="Χ, D, -" />
          </Field>
        )}
      </div>

      <Field>
        <Label>Όνομα μορφής</Label>
        <Input name="profile_name" defaultValue={defaultName} required />
      </Field>

      {state && "error" in state && <p className="text-sm text-red-ink">{state.error}</p>}
      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>
          {pending ? "Ανάγνωση…" : "Αποθήκευση μορφής και συνέχεια"}
        </Button>
      </div>
    </form>
  );
}
