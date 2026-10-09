"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { el } from "@/lib/i18n/el";
import { fillText } from "@/lib/collab/text";
import { assistantQuestion, type MentionPerson } from "@/lib/collab/mentions";
import { AiSpark } from "@/components/ui";
import { MentionText, MentionTextarea } from "./MentionTextarea";
import { COLLAB_FILE_TYPES, isAllowedCollabFile, isImageType } from "./boardFiles";
import type { TeamChatState, TeamMessage } from "./useTeamChat";

const t = el.collab.chat;

const timeFmt = new Intl.DateTimeFormat("el-GR", { hour: "2-digit", minute: "2-digit" });
const dayFmt = new Intl.DateTimeFormat("el-GR", { weekday: "long", day: "numeric", month: "long" });

// The «Ομάδα» tab: the project's team chat. Big touch targets, Enter to
// send, @ to mention someone, and "@βοηθός …" (or the button) hands the
// question to the assistant tab when there is one.
export function TeamChat({
  chat,
  projectId,
  boardId,
  meId,
  people,
  canUpload,
  canManage,
  onAskAssistant,
  onToast,
  confirm,
  boardTitles = {},
}: {
  chat: TeamChatState;
  projectId: string;
  // The board the chat is open on (stored as the message's board link).
  boardId: string | null;
  meId: string;
  people: Record<string, string>;
  canUpload: boolean;
  canManage: boolean;
  onAskAssistant?: (question: string) => void;
  onToast: (message: string, tone?: "neutral" | "error") => void;
  confirm: (req: { message: string }) => Promise<boolean>;
  boardTitles?: Record<string, string>;
}) {
  const [draft, setDraft] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [editing, setEditing] = useState<{ id: string; body: string } | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const mentionPeople: MentionPerson[] = useMemo(
    () => Object.entries(people).map(([userId, name]) => ({ userId, name })),
    [people],
  );
  const names = useMemo(() => Object.values(people), [people]);
  const assistantSuggestion = onAskAssistant ? [{ userId: "__assistant", name: "βοηθός" }] : [];

  const last = chat.messages[chat.messages.length - 1]?.id;
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [last]);

  async function submit() {
    const body = draft.trim();
    if ((!body && files.length === 0) || busy) return;
    const question = assistantQuestion(body);
    if (question && onAskAssistant && files.length === 0) {
      setDraft("");
      onAskAssistant(question);
      return;
    }
    setBusy(true);
    try {
      const ok = await chat.send(body, files, boardId, (done, total) => setProgress(total > 0 ? { done, total } : null));
      if (ok) {
        setDraft("");
        setFiles([]);
      } else {
        onToast(t.sendFailed, "error");
      }
    } catch {
      onToast(t.sendFailed, "error");
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  function addFiles(list: FileList | File[]) {
    const ok: File[] = [];
    let rejected = false;
    for (const f of Array.from(list)) {
      if (isAllowedCollabFile(f.type, f.size)) ok.push(f);
      else rejected = true;
    }
    if (rejected) onToast(el.collab.board.unsupportedFile, "error");
    setFiles((prev) => [...prev, ...ok].slice(0, 10));
  }

  // Day separators between messages from different days.
  const rows: ({ kind: "day"; label: string; key: string } | { kind: "msg"; m: TeamMessage })[] = [];
  let lastDay = "";
  for (const m of chat.messages) {
    const day = m.created_at.slice(0, 10);
    if (day !== lastDay) {
      rows.push({ kind: "day", label: dayFmt.format(new Date(m.created_at)), key: `d-${day}` });
      lastDay = day;
    }
    rows.push({ kind: "msg", m });
  }

  return (
    <div
      className="flex min-h-0 flex-1 flex-col"
      onDragOver={(e) => {
        if (canUpload && e.dataTransfer.types.includes("Files")) e.preventDefault();
      }}
      onDrop={(e) => {
        if (!canUpload || e.dataTransfer.files.length === 0) return;
        e.preventDefault();
        addFiles(e.dataTransfer.files);
      }}
    >
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 py-3 text-sm">
        {chat.loaded && chat.messages.length === 0 && (
          <div className="flex flex-col items-center gap-2 py-10 text-center text-ink-muted">
            <span className="text-3xl" aria-hidden="true">
              👋
            </span>
            <p className="max-w-xs">{t.empty}</p>
          </div>
        )}
        {rows.map((r) =>
          r.kind === "day" ? (
            <div key={r.key} className="py-1 text-center text-[11px] font-medium text-ink-faint">
              {r.label}
            </div>
          ) : (
            <MessageRow
              key={r.m.id}
              m={r.m}
              mine={r.m.author_id === meId}
              author={(r.m.author_id && people[r.m.author_id]) || el.collab.unknownUser}
              names={names}
              projectId={projectId}
              attachments={chat.attachments}
              boardTitle={r.m.board_id && r.m.board_id !== boardId ? boardTitles[r.m.board_id] : undefined}
              canDelete={r.m.author_id === meId || canManage}
              menuOpen={menuFor === r.m.id}
              onMenu={() => setMenuFor((id) => (id === r.m.id ? null : r.m.id))}
              editing={editing?.id === r.m.id ? editing.body : null}
              onEditChange={(body) => setEditing({ id: r.m.id, body })}
              onStartEdit={() => {
                setEditing({ id: r.m.id, body: r.m.body });
                setMenuFor(null);
              }}
              onCancelEdit={() => setEditing(null)}
              onSaveEdit={async () => {
                if (!editing || !editing.body.trim()) return;
                if (await chat.edit(editing.id, editing.body.trim())) setEditing(null);
                else onToast(el.collab.board.saveError, "error");
              }}
              onDelete={async () => {
                setMenuFor(null);
                if (!(await confirm({ message: t.confirmDelete }))) return;
                if (!(await chat.remove(r.m.id))) onToast(el.collab.board.saveError, "error");
              }}
              onAsk={
                onAskAssistant
                  ? () => {
                      setMenuFor(null);
                      onAskAssistant(r.m.body);
                    }
                  : undefined
              }
            />
          ),
        )}
        <div ref={bottomRef} />
      </div>

      <div className="space-y-2 border-t border-line bg-surface px-3 py-2">
        {files.length > 0 && (
          <ul className="flex flex-wrap gap-1.5">
            {files.map((f, i) => (
              <li key={`${f.name}-${i}`} className="flex items-center gap-1 rounded-full bg-bg py-1 pr-1 pl-3 text-xs">
                <span className="max-w-40 truncate">
                  {f.type === "application/pdf" ? "📄" : "🖼️"} {f.name}
                </span>
                <button
                  type="button"
                  className="flex h-8 w-8 items-center justify-center rounded-full text-ink-muted hover:bg-line"
                  aria-label={el.collab.comments.close}
                  onClick={() => setFiles((list) => list.filter((_, j) => j !== i))}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
        {progress && (
          <div className="text-xs text-ink-muted">{fillText(el.collab.fileLibrary.uploading, progress)}</div>
        )}
        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          {canUpload && (
            <>
              <button
                type="button"
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-line-strong text-lg hover:bg-bg"
                title={t.attach}
                aria-label={t.attach}
                onClick={() => fileInput.current?.click()}
              >
                📎
              </button>
              <input
                ref={fileInput}
                type="file"
                multiple
                accept={COLLAB_FILE_TYPES.join(",")}
                className="hidden"
                onChange={(e) => {
                  if (e.target.files) addFiles(e.target.files);
                  e.target.value = "";
                }}
              />
            </>
          )}
          <MentionTextarea
            value={draft}
            onChange={setDraft}
            onSubmit={() => void submit()}
            people={mentionPeople}
            extraSuggestions={assistantSuggestion}
            placeholder={onAskAssistant ? t.placeholderAiHint : t.placeholder}
            rows={2}
            disabled={busy}
          />
          <button
            type="submit"
            disabled={busy || (!draft.trim() && files.length === 0)}
            className="flex h-11 shrink-0 items-center rounded-lg bg-ink px-4 text-sm font-medium text-white hover:bg-ink/85 disabled:opacity-40"
          >
            {t.send}
          </button>
        </form>
        {onAskAssistant && (
          <button
            type="button"
            disabled={!draft.trim()}
            onClick={() => {
              const q = assistantQuestion(draft) ?? draft.trim();
              if (!q) return;
              setDraft("");
              onAskAssistant(q);
            }}
            className="flex min-h-9 items-center gap-1 rounded-full border border-ai-border bg-ai-bg px-3 text-xs text-ai-ink hover:bg-ai-border/40 disabled:opacity-40"
          >
            <AiSpark /> {t.askAssistant}
          </button>
        )}
      </div>
    </div>
  );
}

function MessageRow({
  m,
  mine,
  author,
  names,
  projectId,
  attachments,
  boardTitle,
  canDelete,
  menuOpen,
  onMenu,
  editing,
  onEditChange,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onDelete,
  onAsk,
}: {
  m: TeamMessage;
  mine: boolean;
  author: string;
  names: string[];
  projectId: string;
  attachments: TeamChatState["attachments"];
  boardTitle?: string;
  canDelete: boolean;
  menuOpen: boolean;
  onMenu: () => void;
  editing: string | null;
  onEditChange: (body: string) => void;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSaveEdit: () => void;
  onDelete: () => void;
  onAsk?: () => void;
}) {
  return (
    <div className={`flex ${mine ? "justify-end" : "justify-start"}`}>
      <div className={`group max-w-[88%] ${mine ? "items-end" : "items-start"} flex flex-col`}>
        <div className="flex items-baseline gap-1.5 px-1 text-[11px] text-ink-muted">
          {!mine && <span className="font-medium text-ink">{author}</span>}
          <span>{timeFmt.format(new Date(m.created_at))}</span>
          {m.edited_at && <span>· {el.collab.chat.edited}</span>}
          {boardTitle && (
            <span className="truncate">
              · {el.collab.chat.fromBoard} «{boardTitle}»
            </span>
          )}
        </div>
        <div className={`flex items-start gap-1 ${mine ? "flex-row-reverse" : ""}`}>
          <div className={`rounded-2xl px-3 py-2 ${mine ? "bg-sage text-ink" : "border border-line bg-surface"}`}>
            {editing !== null ? (
              <div className="flex flex-col gap-2">
                <textarea
                  value={editing}
                  onChange={(e) => onEditChange(e.target.value)}
                  rows={3}
                  maxLength={4000}
                  className="w-64 max-w-full rounded-lg border border-line-strong bg-surface px-2 py-1 text-base sm:text-sm"
                  autoFocus
                />
                <div className="flex justify-end gap-2">
                  <button type="button" className="min-h-11 px-3 text-sm" onClick={onCancelEdit}>
                    {el.common.cancel}
                  </button>
                  <button
                    type="button"
                    className="min-h-11 rounded-lg bg-ink px-3 text-sm text-white"
                    onClick={onSaveEdit}
                  >
                    {el.common.save}
                  </button>
                </div>
              </div>
            ) : (
              m.body && (
                <p className="whitespace-pre-wrap break-words">
                  <MentionText body={m.body} names={names} />
                </p>
              )
            )}
            {m.attachment_ids.length > 0 && (
              <ul className="mt-1.5 flex flex-wrap gap-1.5">
                {m.attachment_ids.map((id) => {
                  const a = attachments[id];
                  if (a === null) {
                    return (
                      <li key={id} className="rounded-lg bg-bg px-2 py-1 text-xs text-ink-faint italic">
                        {el.collab.fileLibrary.removed}
                      </li>
                    );
                  }
                  const href = `/collab/${projectId}/files/${id}`;
                  return (
                    <li key={id}>
                      <a href={href} target="_blank" rel="noopener" className="block">
                        {a && isImageType(a.mimeType) ? (
                          // eslint-disable-next-line @next/next/no-img-element -- signed, short-lived URL behind a redirect
                          <img src={href} alt={a.name} className="h-24 max-w-48 rounded-lg border border-line object-cover" />
                        ) : (
                          <span className="flex min-h-11 items-center gap-1 rounded-lg bg-bg px-3 text-xs underline-offset-2 hover:underline">
                            📄 <span className="max-w-40 truncate">{a?.name || "PDF"}</span>
                          </span>
                        )}
                      </a>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          {(canDelete || onAsk) && editing === null && (
            <div className="relative">
              <button
                type="button"
                aria-label={el.collab.project.moreActions}
                className="flex h-9 w-9 items-center justify-center rounded-full text-ink-faint hover:bg-bg hover:text-ink"
                onClick={onMenu}
              >
                ⋯
              </button>
              {menuOpen && (
                <div
                  className={`absolute top-9 z-20 flex w-44 flex-col rounded-lg border border-line bg-surface py-1 text-sm shadow-lg ${
                    mine ? "right-0" : "left-0"
                  }`}
                >
                  {onAsk && (
                    <button type="button" className="min-h-11 px-3 text-left text-ai-ink hover:bg-ai-bg" onClick={onAsk}>
                      <AiSpark /> {el.collab.chat.askAssistant}
                    </button>
                  )}
                  {mine && (
                    <button type="button" className="min-h-11 px-3 text-left hover:bg-bg" onClick={onStartEdit}>
                      {el.collab.chat.edit}
                    </button>
                  )}
                  {canDelete && (
                    <button type="button" className="min-h-11 px-3 text-left text-red-ink hover:bg-red-bg" onClick={onDelete}>
                      {el.collab.chat.delete}
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
