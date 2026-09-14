"use client";

import { useState } from "react";
import { Button, AiSpark } from "@/components/ui";

// Opt-in (button, not auto-run on every page load) so AI spend only happens
// when someone actually wants the summary -- consistent with how the rest
// of the AI layer treats cost as something to spend deliberately.
export function DashboardSummary() {
  const [text, setText] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/ai/dashboard-summary", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Σφάλμα.");
      setText(data.text);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Σφάλμα.");
    } finally {
      setLoading(false);
    }
  }

  if (text) {
    return (
      <div className="rounded-md border border-ai-border bg-ai-bg p-3 text-sm text-ink">
        <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-ai-ink">
          <AiSpark />
          Περίληψη AI
        </div>
        {text}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <Button variant="ai" onClick={generate} disabled={loading}>
        <AiSpark className="mr-1.5" />
        {loading ? "Δημιουργία…" : "AI περίληψη μήνα"}
      </Button>
      {error && <span className="text-sm text-red-ink">{error}</span>}
    </div>
  );
}
