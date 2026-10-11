"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Button, Input } from "@/components/ui";
import { errorOf } from "@/lib/actions";
import { createNdjsonParser, TOOL_LABEL, type ChatEvent } from "@/lib/ai/chatProtocol";
import type { ChangeCard } from "@/lib/ai/changeCards";
import type { Source } from "@/lib/ai/links";
import { ChangeCardView } from "./ChangeCardView";
import {
  deleteConversation,
  listConversations,
  loadConversation,
  type ConversationSummary,
} from "./conversation-actions";

interface ToolChip {
  name: string;
  status: "start" | "done" | "error";
}

interface UiMessage {
  key: string;
  role: "user" | "assistant";
  content: string;
  sources: Source[];
  proposals: ChangeCard[];
  tools: ToolChip[];
  streaming?: boolean;
  error?: string;
}

const SUGGESTIONS = [
  "Τι χρωστάω αυτόν τον μήνα;",
  "Ποια είναι η θέση ΦΠΑ;",
  "Πόσα ξοδέψαμε φέτος ανά κατηγορία;",
  "Ποιος μας χρωστάει;",
];

let keySeq = 0;
const nextKey = () => `m${++keySeq}`;

export function ChatPanel({
  initialPrompt,
  initialConversations,
  canReview,
}: {
  initialPrompt?: string;
  initialConversations: ConversationSummary[];
  canReview: boolean;
}) {
  const [conversations, setConversations] = useState(initialConversations);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [loadingThread, setLoadingThread] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const firedInitialPrompt = useRef(false);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const updateLast = useCallback((fn: (m: UiMessage) => UiMessage) => {
    setMessages((all) => (all.length === 0 ? all : [...all.slice(0, -1), fn(all[all.length - 1])]));
  }, []);

  const refreshList = useCallback(async () => {
    const r = await listConversations();
    if ("error" in r) setListError(r.error);
    else if (r.data) setConversations(r.data);
  }, []);

  function handleEvent(event: ChatEvent) {
    switch (event.type) {
      case "conversation":
        setActiveId(event.conversationId);
        setConversations((list) =>
          list.some((c) => c.id === event.conversationId)
            ? list
            : [{ id: event.conversationId, title: event.title, updatedAt: new Date().toISOString() }, ...list],
        );
        break;
      case "text":
        updateLast((m) => ({ ...m, content: m.content + event.text }));
        break;
      case "tool":
        updateLast((m) => {
          const i = m.tools.findLastIndex((t) => t.name === event.name && t.status === "start");
          const tools =
            event.status === "start" || i < 0
              ? [...m.tools, { name: event.name, status: event.status }]
              : m.tools.map((t, j) => (j === i ? { ...t, status: event.status } : t));
          return { ...m, tools };
        });
        break;
      case "proposal":
        updateLast((m) => ({ ...m, proposals: [...m.proposals, event.proposal] }));
        break;
      case "sources":
        updateLast((m) => ({ ...m, sources: event.sources }));
        break;
      case "done":
        updateLast((m) => ({ ...m, streaming: false }));
        break;
      case "error":
        updateLast((m) => ({ ...m, streaming: false, error: event.error }));
        break;
    }
  }

  async function send(text: string) {
    const message = text.trim();
    if (!message || busy) return;
    setInput("");
    setBusy(true);
    setMessages((all) => [
      ...all,
      { key: nextKey(), role: "user", content: message, sources: [], proposals: [], tools: [] },
      { key: nextKey(), role: "assistant", content: "", sources: [], proposals: [], tools: [], streaming: true },
    ]);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId: activeId, message }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        updateLast((m) => ({ ...m, streaming: false, error: data?.error ?? "Ο βοηθός δεν απάντησε." }));
        return;
      }
      const parser = createNdjsonParser(handleEvent);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        parser.push(decoder.decode(value, { stream: true }));
      }
      parser.push(decoder.decode());
      parser.end();
    } catch {
      if (!controller.signal.aborted) {
        updateLast((m) => ({ ...m, error: "Αποτυχία σύνδεσης με τον βοηθό." }));
      }
    } finally {
      updateLast((m) => ({ ...m, streaming: false }));
      if (abortRef.current === controller) abortRef.current = null;
      setBusy(false);
      void refreshList();
    }
  }

  // Fires once when arriving from a «Ρωτήστε τον βοηθό» link (?q=...).
  useEffect(() => {
    if (initialPrompt && !firedInitialPrompt.current) {
      firedInitialPrompt.current = true;
      void send(initialPrompt);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialPrompt]);

  async function openConversation(id: string) {
    if (busy || id === activeId) return;
    setLoadingThread(true);
    const r = await loadConversation(id);
    setLoadingThread(false);
    if ("error" in r) {
      setListError(r.error);
      return;
    }
    setActiveId(id);
    setMessages(
      (r.data ?? []).map((m) => ({
        key: m.id,
        role: m.role,
        content: m.content,
        sources: m.sources,
        proposals: m.proposals,
        tools: [],
      })),
    );
  }

  function newConversation() {
    if (busy) abortRef.current?.abort();
    setActiveId(null);
    setMessages([]);
    setInput("");
  }

  async function removeConversation(id: string) {
    const r = await deleteConversation(id);
    const message = errorOf(r);
    if (message) {
      setListError(message);
      return;
    }
    setConversations((list) => list.filter((c) => c.id !== id));
    if (id === activeId) newConversation();
  }

  return (
    <div className="grid h-[calc(100vh-8rem)] grid-cols-1 gap-4 md:grid-cols-[14rem_minmax(0,1fr)] md:gap-6">
      <aside className="flex max-h-48 flex-col gap-2 overflow-hidden border-b border-hairline pb-2 md:max-h-none md:border-r md:border-b-0 md:pr-4 md:pb-0">
        <Button type="button" variant="ai" onClick={newConversation}>
          Νέα συζήτηση
        </Button>
        {listError && (
          <p role="alert" className="border-l-2 border-negative pl-2 text-small text-negative">
            {listError}
          </p>
        )}
        <nav aria-label="Συζητήσεις" className="flex-1 overflow-y-auto">
          {conversations.length === 0 ? (
            <p className="py-2 text-small text-muted">Καμία αποθηκευμένη συζήτηση.</p>
          ) : (
            <ul className="flex flex-col">
              {conversations.map((c) => (
                <li key={c.id} className="group flex items-center gap-1 border-b border-hairline">
                  <button
                    type="button"
                    onClick={() => openConversation(c.id)}
                    aria-current={c.id === activeId ? "true" : undefined}
                    className={`min-h-10 flex-1 truncate border-l-2 px-2 py-2 text-left text-small ${
                      c.id === activeId ? "border-ai bg-ai-tint text-ai" : "border-transparent text-muted hover:bg-hover hover:text-ink"
                    }`}
                    title={c.title ?? undefined}
                  >
                    {c.title || "Χωρίς τίτλο"}
                  </button>
                  <button
                    type="button"
                    onClick={() => removeConversation(c.id)}
                    aria-label={`Διαγραφή συζήτησης «${c.title ?? ""}»`}
                    className="flex h-10 w-8 items-center justify-center text-small text-muted opacity-0 group-hover:opacity-100 hover:text-negative focus:opacity-100 max-md:opacity-100"
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
        </nav>
      </aside>

      <div className="flex min-h-0 flex-col gap-3">
        <div className="flex-1 overflow-y-auto border-y border-hairline py-4" aria-live="polite">
          {loadingThread && <p className="text-body text-muted">Φόρτωση συζήτησης…</p>}
          {!loadingThread && messages.length === 0 && (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
              <p className="max-w-prose text-body text-muted">
                Ρωτήστε οτιδήποτε για τα οικονομικά της επιχείρησης — κάθε απάντηση βασίζεται σε πραγματικά δεδομένα
                από το βιβλίο σας, με συνδέσμους στις πηγές.
              </p>
              <div className="flex flex-wrap justify-center gap-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => send(s)}
                    className="inline-flex min-h-9 items-center border border-ai-border px-3 py-1.5 text-small text-ai hover:bg-ai-tint"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="flex flex-col gap-3">
            {messages.map((m) => (
              <MessageView key={m.key} message={m} canReview={canReview} />
            ))}
            <div ref={bottomRef} />
          </div>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void send(input);
          }}
          className="flex gap-2"
        >
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ρωτήστε κάτι για τα οικονομικά σας…"
            disabled={busy}
            maxLength={4000}
            className="flex-1"
            aria-label="Ερώτηση προς τον βοηθό"
          />
          {busy ? (
            <Button type="button" variant="secondary" onClick={() => abortRef.current?.abort()}>
              Διακοπή
            </Button>
          ) : (
            <Button type="submit" variant="ai" disabled={!input.trim()}>
              Αποστολή
            </Button>
          )}
        </form>
      </div>
    </div>
  );
}

function MessageView({ message: m, canReview }: { message: UiMessage; canReview: boolean }) {
  if (m.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] bg-hover px-3 py-2 text-body whitespace-pre-wrap text-ink">{m.content}</div>
      </div>
    );
  }
  const thinking = m.streaming && !m.content && m.tools.length === 0;
  return (
    <div className="flex justify-start">
      <div className="flex max-w-[85%] flex-col gap-2">
        {m.tools.length > 0 && (
          <div className="flex flex-wrap gap-1" aria-label="Εργαλεία">
            {m.tools.map((t, i) => (
              <span
                key={i}
                className={`border px-2 py-0.5 text-eyebrow ${
                  t.status === "error"
                    ? "border-negative text-negative"
                    : t.status === "start"
                      ? "animate-pulse border-ai-border text-ai"
                      : "border-hairline text-muted"
                }`}
              >
                {TOOL_LABEL[t.name] ?? t.name}
                {t.status === "start" ? "…" : t.status === "error" ? " ✕" : " ✓"}
              </span>
            ))}
          </div>
        )}
        {(m.content || thinking) && (
          <div className="border-l-2 border-ai-border py-1 pl-3 text-body whitespace-pre-wrap text-ink">
            {m.content || <span className="text-muted">Ο βοηθός σκέφτεται…</span>}
          </div>
        )}
        {m.proposals.map((p) => (
          <ChangeCardView key={p.id} initial={p} canReview={canReview} />
        ))}
        {m.error && (
          <div role="alert" className="border-l-2 border-negative py-1 pl-3 text-body text-negative">
            {m.error}
          </div>
        )}
        {m.sources.length > 0 && (
          <div className="text-small text-muted">
            <span className="font-medium">Πηγές: </span>
            {m.sources.map((s, i) => (
              <span key={s.href}>
                {i > 0 && " · "}
                <Link href={s.href} className="underline underline-offset-4 hover:text-ink">
                  {s.label}
                </Link>
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
