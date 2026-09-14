"use client";

import { useState } from "react";
import { Button, AiSpark } from "@/components/ui";

export function ProjectHealthCheck({ projectId }: { projectId: string }) {
  const [text, setText] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/ai/project-health", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project_id: projectId }),
      });
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
          AI Έλεγχος Υγείας Έργου
        </div>
        {text}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <Button variant="ai" onClick={generate} disabled={loading}>
        <AiSpark className="mr-1.5" />
        {loading ? "Ανάλυση…" : "AI Έλεγχος Υγείας Έργου"}
      </Button>
      {error && <span className="text-sm text-red-ink">{error}</span>}
    </div>
  );
}
