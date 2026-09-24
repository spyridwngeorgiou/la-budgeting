"use client";

import { useMemo, useState } from "react";
import { Button, Input, Select, Label, Field, Badge } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";
import { formatMoney } from "@/lib/format";
import { deriveFromNet, cashOnly } from "@/lib/finance/money";
import { VAT_RATES } from "@/lib/domain/enums";
import type { Extraction } from "@/lib/ai/schemas";
import { approveDraft, discardDraft } from "./actions";

interface Option {
  id: string;
  label: string;
}

export function ReviewForm({
  draftId,
  queue,
  extraction,
  proposed,
  needsReviewReasons,
  status,
  imageUrl,
  contacts,
  projects,
  categories,
  accounts,
}: {
  draftId: string;
  queue: string;
  extraction: Extraction;
  proposed: { contact_id: string | null; project_id: string | null; category_id: string | null; direction?: "income" | "expense" };
  needsReviewReasons: string[];
  status: string;
  imageUrl: string | null;
  contacts: Option[];
  projects: Option[];
  categories: Option[];
  accounts: Option[];
}) {
  const queueIds = queue ? queue.split(",").filter(Boolean) : [];
  const [direction, setDirection] = useState<"expense" | "income">(proposed.direction ?? "expense");
  const [hasInvoice, setHasInvoice] = useState((extraction.vat.value ?? 0) > 0);
  const [netAmount, setNetAmount] = useState((extraction.net.value ?? extraction.gross.value ?? 0).toString());
  const [vatRate, setVatRate] = useState((extraction.vat_rate ?? 0.24).toString());
  const [withholding, setWithholding] = useState((extraction.withholding.value ?? 0).toString());
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState<Set<string>>(new Set());

  const preview = useMemo(() => {
    const net = Number(netAmount) || 0;
    return hasInvoice
      ? deriveFromNet(net, Number(vatRate) || 0, Number(withholding) || 0)
      : cashOnly(net);
  }, [netAmount, vatRate, withholding, hasInvoice]);

  const amberFields = new Set<string>();
  if (!proposed.contact_id) amberFields.add("contact_id");
  if (!proposed.project_id) amberFields.add("project_id");
  const allTouched = [...amberFields].every((f) => touched.has(f));

  if (status !== "pending") {
    return <p className="text-sm text-ink-muted">Αυτό το πρόχειρο έχει ήδη διεκπεραιωθεί.</p>;
  }

  return (
    <div className="flex flex-col gap-4 md:flex-row">
      {imageUrl && (
        <div className="md:w-1/2">
          {/* On a phone, a tall portrait receipt photo at full natural height
              could push the whole form below the fold right after taking
              it -- the opposite of fast capture. Capped only below md,
              where the two-column desktop layout has room for it full-size. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={imageUrl}
            alt="Παραστατικό"
            className="max-h-[45vh] w-full rounded border border-line object-contain md:max-h-none md:object-fill"
          />
        </div>
      )}

      <div className="flex flex-1 flex-col gap-3">
        <h1 className="text-xl font-semibold">Έλεγχος Πρόχειρης Κίνησης</h1>
        {queueIds.length > 0 && (
          <p className="text-xs text-ink-muted">
            {queueIds.length} ακόμα κίνηση{queueIds.length > 1 ? "εις" : ""} από αυτή την περιγραφή σε αναμονή ελέγχου.
          </p>
        )}

        {needsReviewReasons.length > 0 && (
          <div className="rounded border border-amber-ink/40 bg-amber-bg p-3 text-sm text-amber-ink">
            <ul className="list-disc pl-4">
              {needsReviewReasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </div>
        )}

        {extraction.notes_for_human && (
          <p className="text-xs text-ink-muted">Σημείωση AI: {extraction.notes_for_human}</p>
        )}

        <form
          action={async (formData) => {
            setError(null);
            try {
              await approveDraft(draftId, queueIds, formData);
            } catch (e) {
              if (e instanceof Error && !e.message.includes("NEXT_REDIRECT")) setError(e.message);
              else if (e instanceof Error) throw e;
            }
          }}
          className="flex flex-col gap-3"
        >
          <div className="flex gap-2">
            {(["expense", "income"] as const).map((d) => (
              <label
                key={d}
                className={`flex-1 cursor-pointer rounded border px-3 py-2 text-center text-sm ${
                  direction === d ? "border-ink bg-ink text-white" : "border-line-strong"
                }`}
              >
                <input type="radio" name="direction" value={d} checked={direction === d} onChange={() => setDirection(d)} className="hidden" />
                {d === "expense" ? "Έξοδο" : "Έσοδο"}
              </label>
            ))}
          </div>

          <Field>
            <Label>Ημερομηνία</Label>
            <Input type="date" name="tx_date" defaultValue={extraction.issue_date ?? new Date().toISOString().slice(0, 10)} required />
          </Field>

          <Field>
            <Label className="flex items-center gap-2">
              Επαφή
              {extraction.issuer_name && (
                <span className="text-xs text-ai-ink" title={`AI: ${extraction.issuer_name}`}>
                  (AI: {extraction.issuer_name})
                </span>
              )}
            </Label>
            <Select
              name="contact_id"
              defaultValue={proposed.contact_id ?? ""}
              onBlur={() => setTouched((t) => new Set(t).add("contact_id"))}
              className={amberFields.has("contact_id") ? "border-amber-ink/70" : ""}
            >
              <option value="">—</option>
              {contacts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </Select>
            {amberFields.has("contact_id") && <Badge tone="amber">χρειάζεται έλεγχο</Badge>}
          </Field>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field>
              <Label className="flex items-center gap-2">
                Έργο
                {extraction.project_mention && <span className="text-xs text-ai-ink">(AI: {extraction.project_mention})</span>}
              </Label>
              <Select
                name="project_id"
                defaultValue={proposed.project_id ?? ""}
                onBlur={() => setTouched((t) => new Set(t).add("project_id"))}
                className={amberFields.has("project_id") ? "border-amber-ink/70" : ""}
              >
                <option value="">—</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </Select>
              {amberFields.has("project_id") && <Badge tone="amber">χρειάζεται έλεγχο</Badge>}
            </Field>
            <Field>
              <Label>Κατηγορία</Label>
              <Select name="category_id" defaultValue={proposed.category_id ?? ""}>
                <option value="">—</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <Field>
            <Label>Λογαριασμός</Label>
            <Select name="account_id" required>
              <option value="">—</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                </option>
              ))}
            </Select>
          </Field>

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="has_invoice" checked={hasInvoice} onChange={(e) => setHasInvoice(e.target.checked)} />
            Με παραστατικό
          </label>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field>
              <Label title={extraction.net.evidence ?? undefined}>Καθαρή Αξία</Label>
              <Input type="number" step="0.01" name="net_amount" value={netAmount} onChange={(e) => setNetAmount(e.target.value)} required />
            </Field>
            {hasInvoice && (
              <Field>
                <Label>ΦΠΑ %</Label>
                <Select name="vat_rate" value={vatRate} onChange={(e) => setVatRate(e.target.value)}>
                  {VAT_RATES.map((r) => (
                    <option key={r} value={r}>
                      {(r * 100).toFixed(0)}%
                    </option>
                  ))}
                </Select>
              </Field>
            )}
          </div>

          <div className="rounded bg-bg p-3 text-sm">
            <div className="flex justify-between">
              <span className="text-ai-ink" title={extraction.gross.evidence ?? undefined}>
                Σύνολο (AI: {formatMoney(extraction.gross.value)})
              </span>
              <span className="font-mono font-medium">{formatMoney(preview.gross)}</span>
            </div>
          </div>

          <Field>
            <Label>Κατάσταση</Label>
            <Select name="status" defaultValue="pending">
              <option value="paid">Πληρωμένο</option>
              <option value="pending">Εκκρεμεί</option>
              <option value="scheduled">Προγραμματισμένο</option>
            </Select>
          </Field>

          <Field>
            <Label>Αρ. Παραστατικού</Label>
            <Input name="invoice_number" defaultValue={extraction.invoice_number ?? ""} />
          </Field>

          {error && <p className="text-sm text-red-ink">{error}</p>}

          <div className="mt-2 flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => discardDraft(draftId, queueIds)}>
              Απόρριψη
            </Button>
            <SubmitButton disabled={!allTouched} pendingLabel="Καταχώρηση…">
              Καταχώρηση
            </SubmitButton>
          </div>
          {!allTouched && (
            <p className="text-right text-xs text-amber-700">
              Ελέγξτε τα πεδία με κίτρινο περίγραμμα πριν καταχωρήσετε.
            </p>
          )}
        </form>
      </div>
    </div>
  );
}
