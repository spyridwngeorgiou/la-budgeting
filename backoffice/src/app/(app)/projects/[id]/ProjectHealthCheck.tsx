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
      <div className="flex max-w-prose flex-col gap-1.5 border-l-2 border-ai pl-4 text-sm text-ink">
        <div className="eyebrow flex items-center gap-1.5 text-ai">
          <AiSpark />
          AI Έλεγχος Υγείας Έργου
        </div>
        <p className="whitespace-pre-line">{text}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button variant="ai" onClick={generate} disabled={loading} className="max-md:min-h-11">
        <AiSpark className="mr-1.5" />
        {loading ? "Ανάλυση…" : "AI Έλεγχος Υγείας Έργου"}
      </Button>
      {error && <span className="border-l-2 border-negative pl-3 text-sm text-negative">{error}</span>}
    </div>
  );
}
