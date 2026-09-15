"use client";

import { useState } from "react";
import { SubmitButton } from "@/components/SubmitButton";
import { AiSpark } from "@/components/ui";
import { createRevenuePlanFromText } from "./actions";

export function AiCreateForm() {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      action={async (formData) => {
        setError(null);
        try {
          await createRevenuePlanFromText(formData);
        } catch (e) {
          if (e instanceof Error && !e.message.includes("NEXT_REDIRECT")) setError(e.message);
          else if (!(e instanceof Error)) setError("Σφάλμα.");
          else throw e;
        }
      }}
      className="flex flex-col gap-2 rounded-lg border border-ai-border bg-ai-bg p-4"
    >
      <label className="flex items-center gap-1.5 text-sm font-medium text-ai-ink">
        <AiSpark />
        Περίγραψε την ανάλυση
      </label>
      <textarea
        name="text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="π.χ. Ξενοδοχείο στη Γλυφάδα: 8 Junior Suites στα 100€ με πληρότητα 60%, 8 Deluxe Suites στα 150€ με πληρότητα 55%, 1 Penthouse στα 300€ με πληρότητα 40%. 3 χρόνια από το 2027, με άνοδο πληρότητας το καλοκαίρι."
        rows={3}
        required
        className="rounded-md border border-line-strong bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-ai-strong focus:outline-none"
      />
      {error && <p className="text-sm text-red-ink">{error}</p>}
      <div className="flex justify-end">
        <SubmitButton variant="ai" pendingLabel="Δημιουργία ανάλυσης… (μπορεί να πάρει λίγο)" disabled={!text.trim()}>
          <AiSpark className="mr-1.5" />
          Δημιουργία με AI
        </SubmitButton>
      </div>
    </form>
  );
}
