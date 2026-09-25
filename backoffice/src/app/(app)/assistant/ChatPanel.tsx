"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { Button, Input } from "@/components/ui";

interface Message {
  role: "user" | "assistant";
  content: string;
  transactionIds?: string[];
  changeIds?: string[];
  revenuePlanIds?: string[];
  error?: boolean;
}

const SUGGESTIONS = [
  "Τι χρωστάω αυτόν τον μήνα;",
  "Ποια είναι η θέση ΦΠΑ;",
  "Πόσα ξοδέψαμε στην Ηλιούπολη;",
  "Ποιος μας χρωστάει;",
];

export function ChatPanel({ initialPrompt }: { initialPrompt?: string } = {}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const firedInitialPrompt = useRef(false);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Fires once when arriving from an "Ρώτα γι' αυτόν τον πίνακα" link
  // elsewhere in the app (?q=...) -- guarded by a ref, not state, so a
  // re-render (e.g. from the scroll effect above) can never re-send it.
  useEffect(() => {
    if (initialPrompt && !firedInitialPrompt.current) {
      firedInitialPrompt.current = true;
      send(initialPrompt);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialPrompt]);

  async function send(text: string) {
    if (!text.trim() || loading) return;
    const next = [...messages, { role: "user" as const, content: text }];
    setMessages(next);
    setInput("");
    setLoading(true);
    try {
      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: next.map(({ role, content }) => ({ role, content })) }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessages((m) => [...m, { role: "assistant", content: data.error ?? "Σφάλμα.", error: true }]);
      } else {
        setMessages((m) => [
          ...m,
          {
            role: "assistant",
            content: data.text,
            transactionIds: data.transaction_ids,
            changeIds: data.change_ids,
            revenuePlanIds: data.revenue_plan_ids,
          },
        ]);
      }
    } catch {
      setMessages((m) => [...m, { role: "assistant", content: "Αποτυχία σύνδεσης με τον βοηθό.", error: true }]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex h-[calc(100vh-8rem)] flex-col gap-3">
      <div className="flex-1 overflow-y-auto rounded-lg border border-line bg-surface p-4">
        {messages.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            <p className="text-sm text-ink-muted">
              Ρωτήστε οτιδήποτε για τα οικονομικά της επιχείρησης — κάθε απάντηση βασίζεται σε
              πραγματικά δεδομένα από το βιβλίο σας, όχι σε εικασίες.
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => send(s)}
                  className="rounded-full border border-line-strong px-3 py-1.5 text-xs text-ink-muted hover:bg-bg"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="flex flex-col gap-3">
          {messages.map((m, i) => (
            <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[85%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap ${
                  m.role === "user"
                    ? "bg-ink text-white"
                    : m.error
                      ? "bg-red-bg text-red-ink"
                      : "border border-ai-border bg-ai-bg text-ink"
                }`}
              >
                {m.content}
                {m.transactionIds && m.transactionIds.length > 0 && (
                  <div className="mt-2 border-t border-line-strong/30 pt-2">
                    <Link
                      href={`/transactions?ids=${m.transactionIds.join(",")}`}
                      className="text-xs font-medium underline"
                    >
                      Δείτε τις {m.transactionIds.length} κινήσεις →
                    </Link>
                  </div>
                )}
                {m.changeIds && m.changeIds.length > 0 && (
                  <div className="mt-2 border-t border-line-strong/30 pt-2">
                    <Link href="/changes" className="text-xs font-medium underline">
                      {m.changeIds.length === 1
                        ? "Δείτε την πρόταση αλλαγής →"
                        : `Δείτε τις ${m.changeIds.length} προτάσεις αλλαγών →`}
                    </Link>
                  </div>
                )}
                {m.revenuePlanIds && m.revenuePlanIds.length > 0 && (
                  <div className="mt-2 flex flex-col gap-1 border-t border-line-strong/30 pt-2">
                    {m.revenuePlanIds.map((id) => (
                      <Link key={id} href={`/revenue-plans/${id}`} className="text-xs font-medium underline">
                        Δείτε την ανάλυση εσόδων →
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}
          {loading && <div className="text-sm text-ink-faint">Ο βοηθός σκέφτεται…</div>}
          <div ref={bottomRef} />
        </div>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
        className="flex gap-2"
      >
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ρωτήστε κάτι για τα οικονομικά σας…"
          disabled={loading}
          className="flex-1"
        />
        <Button type="submit" variant="ai" disabled={loading || !input.trim()}>
          Αποστολή
        </Button>
      </form>
    </div>
  );
}
