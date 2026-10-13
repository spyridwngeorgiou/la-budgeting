"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { Button, AiSpark, Notice } from "@/components/ui";

// The button sits with the header's actions; the answer (or an error) opens
// full width under the header, in the #project-health slot the page renders
// (a literal there: a constant exported from this client module would reach
// the server page as a client reference).
const HEALTH_SLOT = "project-health";

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

  const answer = text ? (
    <div className="flex max-w-prose flex-col gap-1.5 border-l-2 border-ai pl-4 text-body text-ink">
      <div className="eyebrow flex items-center gap-1.5 text-ai">
        <AiSpark />
        AI Έλεγχος Υγείας Έργου
      </div>
      <p className="whitespace-pre-line">{text}</p>
    </div>
  ) : error ? (
    <Notice as="span" tone="negative">
      {error}
    </Notice>
  ) : null;

  return (
    <>
      {!text && (
        <Button variant="ai" onClick={generate} disabled={loading}>
          <AiSpark className="mr-1.5" />
          {loading ? "Ανάλυση…" : "AI Έλεγχος Υγείας"}
        </Button>
      )}
      {/* An answer only exists after a click, so `document` is there. */}
      {answer && (document.getElementById(HEALTH_SLOT) ? createPortal(answer, document.getElementById(HEALTH_SLOT)!) : answer)}
    </>
  );
}
