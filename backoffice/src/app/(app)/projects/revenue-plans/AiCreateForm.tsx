"use client";

import { useState } from "react";
import { SubmitButton } from "@/components/SubmitButton";
import { AiSpark, Notice, Textarea } from "@/components/ui";
import { createRevenuePlanFromText } from "./actions";
import { errorOf } from "@/lib/actions";

// The AI family: violet symbol and label on a 2px bar, never a violet fill.
export function AiCreateForm({ projectId }: { projectId?: string }) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const fieldId = projectId ? `ai-plan-text-${projectId}` : "ai-plan-text";

  return (
    <form
      action={async (formData) => {
        setError(null);
        const message = errorOf(await createRevenuePlanFromText(formData));
        if (message) setError(message);
      }}
      className="flex flex-col gap-2 border-l-2 border-ai pl-4"
    >
      {projectId && <input type="hidden" name="project_id" value={projectId} />}
      <label htmlFor={fieldId} className="eyebrow flex items-center gap-1.5 text-ai">
        <AiSpark />
        Περίγραψε την ανάλυση
      </label>
      <Textarea
        id={fieldId}
        name="text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="π.χ. Ξενοδοχείο στη Γλυφάδα: 8 Junior Suites στα 100€ με πληρότητα 60%, 8 Deluxe Suites στα 150€ με πληρότητα 55%, 1 Penthouse στα 300€ με πληρότητα 40%. 3 χρόνια από το 2027, με άνοδο πληρότητας το καλοκαίρι."
        rows={3}
        required
      />
      {error && (
        <Notice tone="negative" role="alert">
          {error}
        </Notice>
      )}
      <div className="flex justify-end">
        <SubmitButton
          variant="ai"
          pendingLabel="Δημιουργία ανάλυσης… (μπορεί να πάρει λίγο)"
          disabled={!text.trim()}
        >
          <AiSpark className="mr-1.5" />
          Δημιουργία με AI
        </SubmitButton>
      </div>
    </form>
  );
}
