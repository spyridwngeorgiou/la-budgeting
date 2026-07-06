"use client";

import { Check } from "lucide-react";
import { markPaid } from "@/app/(app)/transactions/actions";

/** One-tap "mark as paid" button for upcoming transactions. */
export function PayButton({ id, label }: { id: string; label?: string }) {
  return (
    <form
      action={markPaid}
      onSubmit={(e) => {
        if (!confirm("Σήμανση ως «Πληρωμένο»;")) e.preventDefault();
      }}
    >
      <input type="hidden" name="id" value={id} />
      <button
        type="submit"
        className="inline-flex items-center gap-1 rounded-lg bg-positive/10 px-2 py-1 text-xs font-medium text-positive transition hover:bg-positive/20"
        title="Σήμανση ως πληρωμένο"
      >
        <Check size={14} />
        {label ?? "Πλήρωσα"}
      </button>
    </form>
  );
}
