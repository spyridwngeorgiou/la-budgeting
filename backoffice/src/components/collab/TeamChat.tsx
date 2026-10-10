"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { el } from "@/lib/i18n/el";
import { fillText } from "@/lib/collab/text";
import { assistantQuestion, type MentionPerson } from "@/lib/collab/mentions";
import { AiSpark, Button, MenuItem, Textarea, cn } from "@/components/ui";
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
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-3 py-3 text-sm md:px-4">
        {chat.loaded && chat.messages.length === 0 && (
          <p className="max-w-xs py-10 text-small text-muted">{t.empty}</p>
        )}
        {rows.map((r) =>
          r.kind === "day" ? (
            <div key={r.key} className="eyebrow border-b border-hairline pt-4 pb-1.5 text-muted first:pt-0">
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

      <div className="flex flex-col gap-2 border-t border-hairline bg-raised px-3 py-3 md:px-4">
        {files.length > 0 && (
          <ul className="flex flex-wrap gap-1.5">
            {files.map((f, i) => (
              <li key={`${f.name}-${i}`} className="flex items-center gap-1 border border-chip-border bg-field py-0.5 pr-0.5 pl-2.5 text-xs text-ink">
                <span className="max-w-40 truncate">
                  {f.type === "application/pdf" && <span className="text-muted">PDF </span>}
                  {f.name}
                </span>
                <button
                  type="button"
                  className="flex h-8 w-8 items-center justify-center text-muted hover:bg-hover hover:text-ink max-md:h-11 max-md:w-11"
                  aria-label={el.collab.comments.close}
                  onClick={() => setFiles((list) => list.filter((_, j) => j !== i))}
                >
                  <span aria-hidden="true">×</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {progress && (
          <p className="border-l-2 border-navy pl-3 text-xs text-muted">{fillText(el.collab.fileLibrary.uploading, progress)}</p>
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
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="h-11 w-11 shrink-0"
                title={t.attach}
                aria-label={t.attach}
                onClick={() => fileInput.current?.click()}
              >
                <PaperclipIcon />
              </Button>
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
          <Button type="submit" className="h-11 shrink-0" disabled={busy || (!draft.trim() && files.length === 0)}>
            {t.send}
          </Button>
        </form>
        {onAskAssistant && (
          <Button
            type="button"
            variant="ai"
            size="sm"
            className="self-start max-md:min-h-11"
            disabled={!draft.trim()}
            onClick={() => {
              const q = assistantQuestion(draft) ?? draft.trim();
              if (!q) return;
              setDraft("");
              onAskAssistant(q);
            }}
          >
            <AiSpark /> {t.askAssistant}
          </Button>
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
    // A hairline-separated list, not bubbles: own messages carry a 2px navy
    // bar and the hover tint.
    <div
      className={cn(
        "group flex items-start gap-2 border-b border-l-2 border-b-hairline py-2.5 pr-1 pl-3",
        mine ? "border-l-navy bg-hover" : "border-l-transparent",
      )}
    >
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex min-w-0 items-baseline gap-1.5 text-xs text-muted">
          {!mine && <span className="font-medium text-ink">{author}</span>}
          <span className="num">{timeFmt.format(new Date(m.created_at))}</span>
          {m.edited_at && <span>· {el.collab.chat.edited}</span>}
          {boardTitle && (
            <span className="truncate">
              · {el.collab.chat.fromBoard} «{boardTitle}»
            </span>
          )}
        </div>
        <div className="mt-0.5">
          {editing !== null ? (
            <div className="flex flex-col gap-2">
              <Textarea
                value={editing}
                onChange={(e) => onEditChange(e.target.value)}
                rows={3}
                maxLength={4000}
                className="w-full max-md:text-base"
                autoFocus
              />
              <div className="flex justify-end gap-2">
                <Button type="button" variant="secondary" size="sm" className="max-md:min-h-11" onClick={onCancelEdit}>
                  {el.common.cancel}
                </Button>
                <Button type="button" size="sm" className="max-md:min-h-11" onClick={onSaveEdit}>
                  {el.common.save}
                </Button>
              </div>
            </div>
          ) : (
            m.body && (
              <p className="whitespace-pre-wrap break-words text-ink">
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
                    <li key={id} className="border border-hairline px-2 py-1 text-xs text-muted italic">
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
                        <img src={href} alt={a.name} className="h-24 max-w-48 border border-hairline bg-field object-cover" />
                      ) : (
                        <span className="flex min-h-11 items-center gap-1.5 border border-hairline bg-field px-3 text-xs text-ink underline-offset-2 hover:border-navy hover:underline">
                          <span className="font-medium text-negative">PDF</span>
                          <span className="max-w-40 truncate">{a?.name || "PDF"}</span>
                        </span>
                      )}
                    </a>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
      {(canDelete || onAsk) && editing === null && (
        <div className="relative shrink-0">
          <button
            type="button"
            aria-label={el.collab.project.moreActions}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            className="flex h-9 w-9 items-center justify-center text-lg leading-none text-muted hover:bg-raised hover:text-ink max-md:h-11 max-md:w-11"
            onClick={onMenu}
          >
            <span aria-hidden="true">⋯</span>
          </button>
          {menuOpen && (
            <div role="menu" className="absolute top-full right-0 z-20 mt-1 flex w-52 flex-col border border-hairline bg-field py-1">
              {onAsk && (
                <button
                  type="button"
                  role="menuitem"
                  className="flex min-h-10 w-full items-center gap-2 px-3 py-2 text-left text-sm text-ai hover:bg-ai-tint max-md:min-h-11"
                  onClick={onAsk}
                >
                  <AiSpark /> {el.collab.chat.askAssistant}
                </button>
              )}
              {mine && <MenuItem onClick={onStartEdit}>{el.collab.chat.edit}</MenuItem>}
              {canDelete && (
                <MenuItem tone="danger" onClick={onDelete}>
                  {el.collab.chat.delete}
                </MenuItem>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function PaperclipIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-4 w-4" aria-hidden="true">
      <path d="M13.5 7.5 8 13a3.5 3.5 0 0 1-5-5l5.8-5.8a2.3 2.3 0 0 1 3.3 3.3L6.3 11.3a1.2 1.2 0 0 1-1.7-1.7L10 4.2" />
    </svg>
  );
}
