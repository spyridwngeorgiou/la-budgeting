"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";
import { Button, AiSpark } from "@/components/ui";
import { el } from "@/lib/i18n/el";
import { canvasPreview, canvasSpecSummary, canvasSpecToSkeletons, validateCanvasSpec } from "@/lib/ai/collab/skeletons";
import { PROPOSAL_COLUMNS, plannerProposalSchema, type ProposalView } from "@/lib/ai/collab/proposals";
import {
  approveCollabProposal,
  markCanvasProposalApplied,
  rejectCollabProposal,
} from "@/app/(collab)/collab/[projectId]/ai-actions";
import { insertSkeletons, viewportCenter } from "./StickyNoteButton";

// The board assistant panel. Lives inside BoardCanvas's side-panel slot
// (drawer on desktop, bottom sheet on phones) because placing a canvas
// proposal needs the Excalidraw `api`. Everything it reads goes through the
// browser client under the user's RLS; answers come from
// /api/collab/ai/chat as a newline-delimited JSON stream.

const t = el.collabAi;

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  error?: boolean;
}

interface ThreadRow {
  id: string;
  title: string | null;
  updated_at: string;
  created_by: string | null;
}

export interface AiPanelRights {
  canEdit: boolean;
  canApproveTasks: boolean;
  canApproveMilestones: boolean;
}

export function AiPanel({
  supabase,
  boardId,
  api,
  rights,
  onToast,
  meId,
  canManage,
  confirm,
  initialInput = "",
}: {
  supabase: SupabaseClient<Database>;
  boardId: string;
  api: ExcalidrawImperativeAPI | null;
  rights: AiPanelRights;
  onToast: (message: string) => void;
  meId: string;
  // Project lead or org editor: may delete anyone's conversation (0060).
  canManage: boolean;
  confirm: (req: { message: string }) => Promise<boolean>;
  // Prefilled question, e.g. from the selection toolbar or "@βοηθός" in
  // team chat. The parent remounts the panel (key) to apply a new one.
  initialInput?: string;
}) {
  const [threads, setThreads] = useState<ThreadRow[]>([]);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [proposals, setProposals] = useState<ProposalView[]>([]);
  const [input, setInput] = useState(initialInput);
  const [busy, setBusy] = useState(false);
  const [activity, setActivity] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const fetchThreads = useCallback(
    async () =>
      (
        await supabase
          .from("collab_ai_threads")
          .select("id, title, updated_at, created_by")
          .eq("board_id", boardId)
          .order("updated_at", { ascending: false })
          .limit(30)
      ).data ?? [],
    [supabase, boardId],
  );
  const loadThreads = useCallback(async () => setThreads(await fetchThreads()), [fetchThreads]);

  const loadThread = useCallback(
    async (id: string) => {
      const [{ data: msgs }, { data: props }] = await Promise.all([
        supabase
          .from("collab_ai_messages")
          .select("id, role, content")
          .eq("thread_id", id)
          .order("created_at")
          .limit(200),
        supabase
          .from("collab_ai_proposals")
          .select(PROPOSAL_COLUMNS)
          .eq("thread_id", id)
          .order("created_at")
          .limit(100),
      ]);
      setMessages((msgs ?? []).map((m) => ({ id: m.id, role: m.role as ChatMessage["role"], content: m.content })));
      setProposals((props ?? []) as ProposalView[]);
    },
    [supabase],
  );

  // Open the most recent conversation on this board, if any.
  useEffect(() => {
    let cancelled = false;
    void fetchThreads().then((list) => {
      if (cancelled) return;
      setThreads(list);
      if (list[0]) {
        setThreadId(list[0].id);
        void loadThread(list[0].id);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [fetchThreads, loadThread]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, proposals, activity]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const appendAssistant = (id: string, delta: string) =>
    setMessages((list) => list.map((m) => (m.id === id ? { ...m, content: m.content + delta } : m)));

  async function send(text: string) {
    const message = text.trim();
    if (!message || busy) return;
    setInput("");
    setBusy(true);
    setActivity(t.thinking);
    const replyId = `pending-${Date.now()}`;
    setMessages((list) => [
      ...list,
      { id: `local-${Date.now()}`, role: "user", content: message },
      { id: replyId, role: "assistant", content: "" },
    ]);
    const controller = new AbortController();
    abortRef.current = controller;

    const fail = (error: string) =>
      setMessages((list) =>
        list.map((m) => (m.id === replyId ? { ...m, content: m.content ? `${m.content}\n\n${error}` : error, error: true } : m)),
      );

    try {
      const res = await fetch("/api/collab/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ boardId, threadId, message }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        fail(data?.error ?? t.error.generic);
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buffer.indexOf("\n")) !== -1) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (!line) continue;
          let event: { type: string; [k: string]: unknown };
          try {
            event = JSON.parse(line);
          } catch {
            continue;
          }
          switch (event.type) {
            case "thread":
              if (typeof event.threadId === "string") {
                const newId = event.threadId;
                if (newId !== threadId) {
                  setThreadId(newId);
                  void loadThreads();
                }
              }
              break;
            case "text":
              setActivity(null);
              if (typeof event.text === "string") appendAssistant(replyId, event.text);
              break;
            case "tool":
              setActivity(t.tool[String(event.name)] ?? t.thinking);
              break;
            case "proposal":
              setProposals((list) => [...list, event.proposal as ProposalView]);
              break;
            case "error":
              fail(typeof event.error === "string" ? event.error : t.error.generic);
              break;
            case "done":
              if (typeof event.messageId === "string") {
                const savedId = event.messageId;
                setMessages((list) => list.map((m) => (m.id === replyId ? { ...m, id: savedId } : m)));
              }
              break;
          }
        }
      }
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError")) fail(t.error.network);
    } finally {
      // Drop an empty placeholder (aborted before any text).
      setMessages((list) => list.filter((m) => !(m.id === replyId && !m.content)));
      setBusy(false);
      setActivity(null);
      abortRef.current = null;
    }
  }

  const updateProposal = (id: string, status: ProposalView["status"]) =>
    setProposals((list) => list.map((p) => (p.id === id ? { ...p, status } : p)));

  async function decide(p: ProposalView, action: "approve" | "reject" | "place") {
    if (action === "place") {
      const r = validateCanvasSpec((p.payload as { spec?: unknown } | null)?.spec);
      if (!r.ok || !api) {
        onToast(t.proposal.invalid);
        return;
      }
      insertSkeletons(api, canvasSpecToSkeletons(r.spec, viewportCenter(api)));
      const res = await markCanvasProposalApplied(p.id);
      if (res.ok) updateProposal(p.id, "applied");
      else onToast(res.error);
      return;
    }
    const res = action === "approve" ? await approveCollabProposal(p.id) : await rejectCollabProposal(p.id);
    if (res.ok) updateProposal(p.id, action === "approve" ? "approved" : "rejected");
    else onToast(res.error);
  }

  const quick = [t.quick.summary, t.quick.decisions, t.quick.questions];
  const current = threads.find((th) => th.id === threadId);
  const canDeleteThread = !!current && (canManage || current.created_by === meId);

  async function deleteThread() {
    if (!threadId || !(await confirm({ message: t.confirmDeleteThread }))) return;
    const { data, error } = await supabase.from("collab_ai_threads").delete().eq("id", threadId).select("id");
    if (error || !data || data.length === 0) {
      onToast(t.error.saveFailed);
      return;
    }
    setThreads((list) => list.filter((th) => th.id !== threadId));
    setThreadId(null);
    setMessages([]);
    setProposals([]);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b border-line px-3 py-2 text-xs">
        <select
          className="min-w-0 flex-1 truncate rounded border border-line bg-surface px-2 py-1"
          value={threadId ?? ""}
          aria-label={t.history}
          disabled={busy}
          onChange={(e) => {
            const id = e.target.value || null;
            setThreadId(id);
            setProposals([]);
            setMessages([]);
            if (id) void loadThread(id);
          }}
        >
          <option value="">{t.newThread}</option>
          {threads.map((th) => (
            <option key={th.id} value={th.id}>
              {(th.title ?? t.untitledThread).slice(0, 60)}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="shrink-0 rounded px-2 py-1 text-ai-ink hover:bg-ai-bg disabled:opacity-50"
          disabled={busy || threadId === null}
          onClick={() => {
            setThreadId(null);
            setMessages([]);
            setProposals([]);
          }}
        >
          + {t.newThread}
        </button>
        {threadId && canDeleteThread && (
          <button
            type="button"
            className="shrink-0 rounded px-2 py-1 text-red-ink hover:bg-red-bg disabled:opacity-50"
            disabled={busy}
            onClick={() => void deleteThread()}
            title={t.deleteThread}
          >
            {t.deleteThread}
          </button>
        )}
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3 text-sm">
        {messages.length === 0 && (
          <div className="space-y-3">
            <p className="text-ink-muted">{t.intro}</p>
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={m.role === "user" ? "flex justify-end" : ""}>
            <div
              className={
                m.role === "user"
                  ? "max-w-[85%] whitespace-pre-wrap rounded-lg bg-bg px-3 py-2"
                  : `whitespace-pre-wrap rounded-lg border px-3 py-2 ${
                      m.error ? "border-red-200 bg-red-50 text-red-ink" : "border-ai-border bg-ai-bg/50"
                    }`
              }
            >
              {m.role === "assistant" && (
                <div className="mb-1 flex items-center gap-1 text-[11px] font-medium text-ai-ink">
                  <AiSpark /> {t.assistant}
                </div>
              )}
              {m.content}
            </div>
          </div>
        ))}
        {proposals.map((p) => (
          <ProposalCard key={p.id} proposal={p} rights={rights} canPlace={!!api} onDecide={(a) => decide(p, a)} />
        ))}
        {activity && (
          <div className="flex items-center gap-1.5 text-xs text-ai-ink">
            <AiSpark className="animate-pulse" /> {activity}
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="space-y-2 border-t border-line px-3 py-2">
        <div className="flex flex-wrap gap-1.5">
          {quick.map((q) => (
            <button
              key={q.label}
              type="button"
              disabled={busy}
              onClick={() => void send(q.prompt)}
              className="rounded-full border border-ai-border bg-ai-bg px-2.5 py-1 text-xs text-ai-ink hover:bg-ai-border/40 disabled:opacity-50"
            >
              {q.label}
            </button>
          ))}
        </div>
        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void send(input);
          }}
        >
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send(input);
              }
            }}
            rows={2}
            maxLength={4000}
            placeholder={t.placeholder}
            className="min-h-[2.5rem] flex-1 resize-none rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm focus:border-ai-strong focus:outline-none"
          />
          {busy ? (
            <Button type="button" variant="secondary" onClick={() => abortRef.current?.abort()}>
              {t.stop}
            </Button>
          ) : (
            <Button type="submit" variant="ai" disabled={!input.trim()}>
              <AiSpark className="mr-1" />
              {t.send}
            </Button>
          )}
        </form>
      </div>
    </div>
  );
}

function ProposalCard({
  proposal,
  rights,
  canPlace,
  onDecide,
}: {
  proposal: ProposalView;
  rights: AiPanelRights;
  canPlace: boolean;
  onDecide: (action: "approve" | "reject" | "place") => Promise<void>;
}) {
  const [pending, setPending] = useState(false);
  const run = (a: "approve" | "reject" | "place") => {
    setPending(true);
    void onDecide(a).finally(() => setPending(false));
  };
  const p = t.proposal;
  const decided =
    proposal.status === "applied"
      ? p.placed
      : proposal.status === "approved"
        ? p.approved
        : proposal.status === "rejected"
          ? p.rejected
          : null;

  const canvas = useMemo(() => {
    if (proposal.kind !== "canvas") return null;
    const r = validateCanvasSpec((proposal.payload as { spec?: unknown } | null)?.spec);
    return r.ok ? { spec: r.spec, preview: canvasPreview(r.spec) } : null;
  }, [proposal]);

  const planner = useMemo(() => {
    if (proposal.kind === "canvas") return null;
    const r = plannerProposalSchema.safeParse({ kind: proposal.kind, ...(proposal.payload as object) });
    return r.success ? r.data : null;
  }, [proposal]);

  const title = proposal.kind === "canvas" ? p.canvas : proposal.kind === "tasks" ? p.tasks : p.milestones;
  const canApprove = proposal.kind === "tasks" ? rights.canApproveTasks : rights.canApproveMilestones;

  return (
    <div className="rounded-lg border border-ai-border bg-surface p-3 shadow-sm">
      <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-ai-ink">
        <AiSpark /> {title}
        {canvas && <span className="font-normal text-ink-muted">· {canvasSpecSummary(canvas.spec)}</span>}
      </div>

      {proposal.kind === "canvas" &&
        (canvas ? (
          <svg viewBox={canvas.preview.viewBox} className="h-36 w-full rounded border border-line bg-white" role="img" aria-label={title}>
            {canvas.preview.lines.map((l, i) => (
              <line key={i} x1={l.a.x} y1={l.a.y} x2={l.b.x} y2={l.b.y} stroke="#868e96" strokeWidth={3} />
            ))}
            {canvas.preview.nodes.map((n) =>
              n.type === "ellipse" ? (
                <ellipse
                  key={n.id}
                  cx={n.x + n.width / 2}
                  cy={n.y + n.height / 2}
                  rx={n.width / 2}
                  ry={n.height / 2}
                  fill={n.fill}
                  stroke={n.stroke}
                  strokeWidth={2}
                />
              ) : n.type === "diamond" ? (
                <polygon
                  key={n.id}
                  points={`${n.x + n.width / 2},${n.y} ${n.x + n.width},${n.y + n.height / 2} ${n.x + n.width / 2},${n.y + n.height} ${n.x},${n.y + n.height / 2}`}
                  fill={n.fill}
                  stroke={n.stroke}
                  strokeWidth={2}
                />
              ) : (
                <rect key={n.id} x={n.x} y={n.y} width={n.width} height={n.height} rx={6} fill={n.fill} stroke={n.stroke} strokeWidth={2} />
              ),
            )}
          </svg>
        ) : (
          <p className="text-xs text-red-ink">{p.invalid}</p>
        ))}

      {planner && (
        <ul className="space-y-1 text-sm">
          {planner.items.map((item, i) => (
            <li key={i} className="flex items-baseline justify-between gap-2">
              <span className="min-w-0">{item.title}</span>
              {item.due_date && (
                <span className="shrink-0 text-xs text-ink-muted">
                  {p.due} {item.due_date}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {proposal.kind !== "canvas" && !planner && <p className="text-xs text-red-ink">{p.invalid}</p>}

      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
        {decided ? (
          <span className="text-ink-muted">{decided}</span>
        ) : proposal.kind === "canvas" ? (
          rights.canEdit ? (
            <>
              <Button variant="aiSolid" className="px-2.5 py-1 text-xs" disabled={pending || !canvas || !canPlace} onClick={() => run("place")}>
                {p.place}
              </Button>
              <Button variant="secondary" className="px-2.5 py-1 text-xs" disabled={pending} onClick={() => run("reject")}>
                {p.reject}
              </Button>
            </>
          ) : (
            <span className="text-ink-muted">{p.needsEdit}</span>
          )
        ) : canApprove ? (
          <>
            <Button variant="aiSolid" className="px-2.5 py-1 text-xs" disabled={pending || !planner} onClick={() => run("approve")}>
              {p.approve}
            </Button>
            <Button variant="secondary" className="px-2.5 py-1 text-xs" disabled={pending} onClick={() => run("reject")}>
              {p.reject}
            </Button>
          </>
        ) : (
          <span className="text-ink-muted">{proposal.kind === "milestones" ? p.needsEditor : p.needsLead}</span>
        )}
      </div>
    </div>
  );
}
