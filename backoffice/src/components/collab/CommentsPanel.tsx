"use client";

import { useMemo, useState } from "react";
import { el } from "@/lib/i18n/el";
import { Button } from "@/components/ui";
import type { BoardComment } from "./types";

export type CommentAnchor = { element_id: string | null; scene_x: number; scene_y: number };

const timeFormatter = new Intl.DateTimeFormat("el-GR", {
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

// Threads for the board: a composer (optionally pinned to a canvas point or
// the selected element), then open threads newest first, resolved ones
// behind a toggle. Anyone with access may comment and reply -- guests
// included; resolving is for editors and the thread's author.
export function CommentsPanel({
  comments,
  people,
  meId,
  canEdit,
  focusedId,
  draftAnchor,
  canAnchorToSelection,
  onStartPlacing,
  onAnchorToSelection,
  onClearAnchor,
  onCreate,
  onResolve,
  onDelete,
  onFocus,
}: {
  comments: BoardComment[];
  people: Record<string, string>;
  meId: string;
  canEdit: boolean;
  focusedId: string | null;
  draftAnchor: CommentAnchor | null;
  canAnchorToSelection: boolean;
  onStartPlacing: () => void;
  onAnchorToSelection: () => void;
  onClearAnchor: () => void;
  onCreate: (body: string, anchor: CommentAnchor | null, parentId: string | null) => Promise<boolean>;
  onResolve: (id: string, resolved: boolean) => void;
  onDelete: (id: string) => void;
  onFocus: (comment: BoardComment) => void;
}) {
  const [showResolved, setShowResolved] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  const { roots, replies } = useMemo(() => {
    const replies = new Map<string, BoardComment[]>();
    const roots: BoardComment[] = [];
    for (const c of comments) {
      if (c.parent_id) {
        const list = replies.get(c.parent_id) ?? [];
        list.push(c);
        replies.set(c.parent_id, list);
      } else {
        roots.push(c);
      }
    }
    roots.sort((a, b) => b.created_at.localeCompare(a.created_at));
    for (const list of replies.values()) list.sort((a, b) => a.created_at.localeCompare(b.created_at));
    return { roots, replies };
  }, [comments]);

  const visible = roots.filter((r) => showResolved || !r.resolved_at);
  const resolvedCount = roots.filter((r) => r.resolved_at).length;
  const nameOf = (id: string | null) => (id && people[id]) || el.collab.unknownUser;

  async function submit() {
    const body = draft.trim();
    if (!body || busy) return;
    setBusy(true);
    if (await onCreate(body, draftAnchor, null)) setDraft("");
    setBusy(false);
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-col gap-2 border-b border-line p-3">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={el.collab.comments.placeholder}
          rows={3}
          maxLength={4000}
          className="w-full resize-none rounded-md border border-line-strong bg-surface px-3 py-2 text-sm focus:border-sage-strong focus:outline-none"
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void submit();
          }}
        />
        <div className="flex flex-wrap items-center gap-1.5">
          {draftAnchor ? (
            <button
              type="button"
              onClick={onClearAnchor}
              className="rounded bg-amber-bg px-2 py-1 text-xs text-amber-ink"
              title={el.common.cancel}
            >
              📍 {draftAnchor.element_id ? el.collab.comments.anchoredToSelection : el.collab.comments.pin} ×
            </button>
          ) : (
            <>
              <Button type="button" variant="secondary" className="!px-2 !py-1 text-xs" onClick={onStartPlacing}>
                📍 {el.collab.comments.pin}
              </Button>
              {canAnchorToSelection && (
                <Button type="button" variant="secondary" className="!px-2 !py-1 text-xs" onClick={onAnchorToSelection}>
                  {el.collab.comments.anchoredToSelection}
                </Button>
              )}
            </>
          )}
          <Button
            type="button"
            className="ml-auto !px-3 !py-1 text-xs"
            disabled={!draft.trim() || busy}
            onClick={() => void submit()}
          >
            {el.collab.comments.send}
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {visible.length === 0 && <p className="py-4 text-center text-sm text-ink-faint">{el.collab.comments.none}</p>}
        <ul className="flex flex-col gap-3">
          {visible.map((root) => (
            <Thread
              key={root.id}
              root={root}
              replies={replies.get(root.id) ?? []}
              focused={focusedId === root.id}
              nameOf={nameOf}
              canResolve={canEdit || root.author_id === meId}
              meId={meId}
              onReply={(body) => onCreate(body, null, root.id)}
              onResolve={onResolve}
              onDelete={onDelete}
              onFocus={onFocus}
            />
          ))}
        </ul>
        {resolvedCount > 0 && (
          <button
            type="button"
            onClick={() => setShowResolved((v) => !v)}
            className="mt-3 w-full text-center text-xs text-ink-muted hover:text-ink"
          >
            {el.collab.comments.showResolved} ({resolvedCount}) {showResolved ? "▲" : "▼"}
          </button>
        )}
      </div>
    </div>
  );
}

function Thread({
  root,
  replies,
  focused,
  nameOf,
  canResolve,
  meId,
  onReply,
  onResolve,
  onDelete,
  onFocus,
}: {
  root: BoardComment;
  replies: BoardComment[];
  focused: boolean;
  nameOf: (id: string | null) => string;
  canResolve: boolean;
  meId: string;
  onReply: (body: string) => Promise<boolean>;
  onResolve: (id: string, resolved: boolean) => void;
  onDelete: (id: string) => void;
  onFocus: (comment: BoardComment) => void;
}) {
  const [reply, setReply] = useState("");
  const anchored = root.element_id !== null || root.scene_x !== null;

  return (
    <li
      className={`rounded-md border p-2.5 text-sm ${focused ? "border-sage-strong bg-sage/30" : "border-line bg-surface"} ${
        root.resolved_at ? "opacity-60" : ""
      }`}
    >
      <CommentBody comment={root} nameOf={nameOf} mine={root.author_id === meId} onDelete={onDelete} />
      {replies.map((r) => (
        <div key={r.id} className="mt-2 border-l-2 border-line pl-2">
          <CommentBody comment={r} nameOf={nameOf} mine={r.author_id === meId} onDelete={onDelete} />
        </div>
      ))}
      <div className="mt-2 flex items-center gap-1.5">
        <input
          value={reply}
          onChange={(e) => setReply(e.target.value)}
          placeholder={el.collab.comments.replyPlaceholder}
          maxLength={4000}
          className="min-w-0 flex-1 rounded border border-line px-2 py-1 text-xs focus:border-sage-strong focus:outline-none"
          onKeyDown={async (e) => {
            if (e.key === "Enter" && reply.trim()) {
              if (await onReply(reply.trim())) setReply("");
            }
          }}
        />
        {anchored && (
          <button
            type="button"
            className="rounded px-1.5 py-1 text-xs text-ink-muted hover:bg-bg"
            onClick={() => onFocus(root)}
            aria-label={el.collab.comments.showOnBoard}
          >
            📍
          </button>
        )}
        {canResolve && (
          <button
            type="button"
            className="rounded px-1.5 py-1 text-xs text-sage-ink hover:bg-sage/40"
            onClick={() => onResolve(root.id, !root.resolved_at)}
          >
            {root.resolved_at ? el.collab.comments.reopen : el.collab.comments.resolve}
          </button>
        )}
      </div>
    </li>
  );
}

function CommentBody({
  comment,
  nameOf,
  mine,
  onDelete,
}: {
  comment: BoardComment;
  nameOf: (id: string | null) => string;
  mine: boolean;
  onDelete: (id: string) => void;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 text-xs text-ink-muted">
        <span className="font-medium text-ink">{nameOf(comment.author_id)}</span>
        <span className="flex items-center gap-1.5">
          {timeFormatter.format(new Date(comment.created_at))}
          {mine && (
            <button
              type="button"
              className="text-ink-faint hover:text-red-ink"
              onClick={() => onDelete(comment.id)}
              aria-label={el.collab.comments.delete}
              title={el.collab.comments.delete}
            >
              ×
            </button>
          )}
        </span>
      </div>
      <p className="mt-0.5 whitespace-pre-wrap break-words">{comment.body}</p>
    </div>
  );
}
