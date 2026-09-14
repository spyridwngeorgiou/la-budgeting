"use client";

import { useState } from "react";
import { Button } from "@/components/ui";

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
      <div className="rounded-md border border-sage bg-sage/20 p-3 text-sm text-ink">
        <div className="mb-1 text-xs font-medium text-sage-ink">AI Έλεγχος Υγείας Έργου</div>
        {text}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <Button variant="secondary" onClick={generate} disabled={loading}>
        {loading ? "Ανάλυση…" : "✨ AI Έλεγχος Υγείας Έργου"}
      </Button>
      {error && <span className="text-sm text-red-ink">{error}</span>}
    </div>
  );
}
