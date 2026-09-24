"use client";

import { useState } from "react";
import { Button, Input, Label, Field } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";

export interface ScenarioInitial {
  name?: string;
  flat_annual_revenue?: number | null;
  revenue_growth_pct?: number;
  opex_growth_pct?: number;
  growth_starts_after_operating_year?: number;
  discount_rate_pct?: number;
  dscr_covenant_min?: number;
  notes?: string | null;
}

export function ScenarioFormModal({
  action,
  initial,
  trigger,
}: {
  action: (formData: FormData) => Promise<void>;
  initial?: ScenarioInitial;
  trigger?: string;
}) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <Button variant="secondary" onClick={() => setOpen(true)}>
        {trigger ?? "Επεξεργασία Παραδοχών"}
      </Button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded bg-white p-5">
        <form
          action={async (formData) => {
            await action(formData);
            setOpen(false);
          }}
          className="flex flex-col gap-3"
        >
          <Field>
            <Label>Όνομα Σεναρίου</Label>
            <Input name="name" defaultValue={initial?.name ?? "Βασικό"} required />
          </Field>
          <Field>
            <Label>Σταθερός ετήσιος τζίρος (€, αν δεν υπάρχει ανάλυση εσόδων)</Label>
            <Input type="number" step="0.01" name="flat_annual_revenue" defaultValue={initial?.flat_annual_revenue ?? ""} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field>
              <Label>Ανάπτυξη εσόδων (%/έτος)</Label>
              <Input
                type="number"
                step="0.01"
                name="revenue_growth_pct_pct"
                defaultValue={initial?.revenue_growth_pct != null ? initial.revenue_growth_pct * 100 : 0}
              />
            </Field>
            <Field>
              <Label title="Opex (Operating Expenses) — λειτουργικά έξοδα, εκτός μισθώματος και εξυπηρέτησης δανείου.">
                Ανάπτυξη opex (%/έτος)
              </Label>
              <Input
                type="number"
                step="0.01"
                name="opex_growth_pct_pct"
                defaultValue={initial?.opex_growth_pct != null ? initial.opex_growth_pct * 100 : 0}
              />
            </Field>
          </div>
          <Field>
            <Label>Η ανάπτυξη ξεκινά μετά το λειτουργικό έτος</Label>
            <Input
              type="number"
              min={0}
              name="growth_starts_after_operating_year"
              defaultValue={initial?.growth_starts_after_operating_year ?? 3}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field>
              <Label title="Το επιτόκιο με το οποίο προεξοφλούνται οι μελλοντικές ταμειακές ροές για τον υπολογισμό της Καθαρής Παρούσας Αξίας (NPV) — υψηλότερο επιτόκιο σημαίνει ότι το μελλοντικό χρήμα αξίζει λιγότερο σήμερα.">
                Προεξοφλητικό επιτόκιο (%)
              </Label>
              <Input
                type="number"
                step="0.01"
                name="discount_rate_pct_pct"
                defaultValue={initial?.discount_rate_pct != null ? initial.discount_rate_pct * 100 : 9}
              />
            </Field>
            <Field>
              <Label title="DSCR (Debt Service Coverage Ratio) — Δείκτης Κάλυψης Εξυπηρέτησης Χρέους: λειτουργικό αποτέλεσμα ÷ ετήσια δόση δανείου. Πάνω από 1.0× σημαίνει ότι τα έσοδα καλύπτουν τη δόση.">
                Ελάχιστο DSCR
              </Label>
              <Input type="number" step="0.01" name="dscr_covenant_min" defaultValue={initial?.dscr_covenant_min ?? 1.2} />
            </Field>
          </div>
          <Field>
            <Label>Σημειώσεις</Label>
            <textarea
              name="notes"
              defaultValue={initial?.notes ?? ""}
              rows={2}
              className="rounded-md border border-line-strong bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-sage-strong focus:outline-none"
            />
          </Field>
          <div className="mt-2 flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Ακύρωση
            </Button>
            <SubmitButton>Αποθήκευση</SubmitButton>
          </div>
        </form>
      </div>
    </div>
  );
}
