"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { Button, Input, Notice, cn, useConfirm, useToast } from "@/components/ui";
import { errorOf } from "@/lib/actions";
import { el } from "@/lib/i18n/el";
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

const a = el.assistant;

let keySeq = 0;
const nextKey = () => `m${++keySeq}`;

// The conversation list and the chat. From md it fills the height the page
// gives it (`className`) and only the messages scroll; on a phone the page
// scrolls, the list folds into «▸ Συζητήσεις (N)» and the question box
// sticks to the bottom, clear of the «＋» button.
export function ChatPanel({
  initialPrompt,
  initialConversations,
  canReview,
  className = "",
}: {
  initialPrompt?: string;
  initialConversations: ConversationSummary[];
  canReview: boolean;
  className?: string;
}) {
  const [conversations, setConversations] = useState(initialConversations);
  const [listOpen, setListOpen] = useState(false);
  const listId = useId();
  const { confirm, dialog } = useConfirm();
  const { show } = useToast();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [loadingThread, setLoadingThread] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const firedInitialPrompt = useRef(false);

  // Follow the conversation; nothing to follow before the first message (on
  // a phone that would scroll the page past the header on arrival).
  useEffect(() => {
    if (messages.length > 0) bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
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
    // On a phone the folded list closes again, so the conversation shows.
    setListOpen(false);
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
    setListOpen(false);
    setActiveId(null);
    setMessages([]);
    setInput("");
  }

  async function removeConversation(id: string, title: string | null) {
    const message = `${a.deleteConversation} «${title || a.untitled}»; ${a.cannotUndo}`;
    if (!(await confirm({ message, confirmLabel: el.common.delete }))) return;
    const r = await deleteConversation(id);
    const error = errorOf(r);
    if (error) {
      show(error, { tone: "negative" });
      return;
    }
    setConversations((list) => list.filter((c) => c.id !== id));
    if (id === activeId) newConversation();
    show(a.deleted);
  }

  return (
    <div
      className={cn(
        "grid grid-cols-1 gap-4 md:grid-cols-[14rem_minmax(0,1fr)] md:grid-rows-[minmax(0,1fr)] md:gap-6",
        className,
      )}
    >
      <aside className="flex flex-col gap-2 border-b border-hairline pb-2 md:min-h-0 md:border-r md:border-b-0 md:pr-4 md:pb-0">
        <div className="flex items-center justify-between gap-2 md:flex-col md:items-stretch">
          {/* Phones: the list folds into «▸ Συζητήσεις (N)». */}
          <button
            type="button"
            aria-expanded={listOpen}
            aria-controls={listId}
            onClick={() => setListOpen((v) => !v)}
            className="flex min-h-11 min-w-0 items-center gap-2 text-left md:hidden"
          >
            <span aria-hidden="true" className={cn("inline-block w-3 text-muted transition-transform", listOpen && "rotate-90")}>
              ▸
            </span>
            <span className="text-body font-medium text-ink">
              {a.conversations} <span className="num font-normal text-muted">({conversations.length})</span>
            </span>
          </button>
          <Button type="button" variant="ai" onClick={newConversation} className="shrink-0">
            {a.newConversation}
          </Button>
        </div>
        {listError && (
          <Notice tone="negative" size="small" role="alert">
            {listError}
          </Notice>
        )}
        <nav
          id={listId}
          aria-label={a.conversations}
          className={cn("md:block md:min-h-0 md:flex-1 md:overflow-y-auto", listOpen ? "block" : "hidden")}
        >
          {conversations.length === 0 ? (
            <p className="py-2 text-small text-muted">{a.noConversations}</p>
          ) : (
            <ul className="flex flex-col">
              {conversations.map((c) => {
                const label = `${a.deleteConversation} «${c.title || a.untitled}»`;
                return (
                  <li key={c.id} className="group flex items-center gap-1 border-b border-hairline">
                    <button
                      type="button"
                      onClick={() => openConversation(c.id)}
                      aria-current={c.id === activeId ? "true" : undefined}
                      className={`min-h-10 min-w-0 flex-1 truncate border-l-2 px-2 py-2 text-left text-small ${
                        c.id === activeId ? "border-ai bg-ai-tint text-ai" : "border-transparent text-muted hover:bg-hover hover:text-ink"
                      }`}
                      title={c.title ?? undefined}
                    >
                      {c.title || a.untitled}
                    </button>
                    {/* Shown on hover and whenever the row has focus (always on a phone). */}
                    <button
                      type="button"
                      onClick={() => removeConversation(c.id, c.title)}
                      aria-label={label}
                      title={label}
                      className="flex min-h-10 min-w-10 items-center justify-center text-body text-muted opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 hover:text-negative max-md:opacity-100"
                    >
                      <span aria-hidden="true">×</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-col gap-3 md:min-h-0">
        {/* The one scroll from md; on a phone the page scrolls instead. */}
        <div className="border-y border-hairline py-4 md:min-h-0 md:flex-1 md:overflow-y-auto md:overscroll-contain" aria-live="polite">
          {loadingThread && <p className="text-body text-muted">Φόρτωση συζήτησης…</p>}
          {!loadingThread && messages.length === 0 && (
            <div className="flex flex-col items-start gap-3 md:h-full md:items-center md:justify-center md:text-center">
              <p className="text-body text-ink">{a.emptyTitle}</p>
              <div className="flex flex-wrap gap-2 md:justify-center">
                {a.examples.map((s) => (
                  <Button key={s} type="button" variant="ai" size="sm" disabled={busy} onClick={() => send(s)}>
                    {s}
                  </Button>
                ))}
              </div>
            </div>
          )}
          <div className="flex flex-col gap-3">
            {messages.map((m) => (
              <MessageView key={m.key} message={m} canReview={canReview} />
            ))}
            {/* Room for the sticky question box when the page follows it on a phone. */}
            <div ref={bottomRef} className="max-md:scroll-mb-24" />
          </div>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void send(input);
          }}
          className={cn(
            "flex gap-2",
            "max-md:sticky max-md:bottom-0 max-md:z-20 max-md:-mx-4 max-md:border-t max-md:border-hairline max-md:bg-canvas max-md:pt-2 max-md:pb-[calc(0.5rem+env(safe-area-inset-bottom))] max-md:pl-4",
            // Editors have the «＋» button in the bottom-right corner.
            canReview ? "max-md:pr-20" : "max-md:pr-4",
          )}
        >
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ρωτήστε κάτι για τα οικονομικά σας…"
            disabled={busy}
            maxLength={4000}
            className="min-w-0 flex-1"
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
      {dialog}
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
          <Notice as="div" tone="negative" role="alert">
            {m.error}
          </Notice>
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
