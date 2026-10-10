"use client";

import { useMemo, useState } from "react";
import { el } from "@/lib/i18n/el";
import { Button, Input, cn } from "@/components/ui";
import { MentionText, MentionTextarea } from "./MentionTextarea";
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
  canManage,
  confirm,
}: {
  comments: BoardComment[];
  people: Record<string, string>;
  meId: string;
  canEdit: boolean;
  // Project lead or org editor: may delete anyone's comment (0060).
  canManage: boolean;
  confirm: (req: { message: string }) => Promise<boolean>;
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
  const mentionPeople = useMemo(() => Object.entries(people).map(([userId, name]) => ({ userId, name })), [people]);
  const names = useMemo(() => Object.values(people), [people]);

  async function confirmDelete(id: string) {
    const hasReplies = (replies.get(id) ?? []).length > 0;
    const ok = await confirm({
      message: hasReplies ? el.collab.comments.confirmDeleteThread : el.collab.comments.confirmDelete,
    });
    if (ok) onDelete(id);
  }

  async function submit() {
    const body = draft.trim();
    if (!body || busy) return;
    setBusy(true);
    if (await onCreate(body, draftAnchor, null)) setDraft("");
    setBusy(false);
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-col gap-2 border-b border-hairline p-3">
        <MentionTextarea
          value={draft}
          onChange={setDraft}
          onSubmit={() => void submit()}
          people={mentionPeople}
          placeholder={el.collab.comments.placeholder}
          rows={3}
          submitOn="mod-enter"
        />
        <p className="text-xs text-muted">{el.collab.comments.mentionHint}</p>
        <div className="flex flex-wrap items-center gap-1.5">
          {draftAnchor ? (
            <button
              type="button"
              onClick={onClearAnchor}
              className="inline-flex min-h-8 items-center gap-1 border border-warning bg-warning-tint px-2.5 py-1 text-small text-warning max-md:min-h-11"
              title={el.common.cancel}
            >
              📍 {draftAnchor.element_id ? el.collab.comments.anchoredToSelection : el.collab.comments.pin} ×
            </button>
          ) : (
            <>
              <Button type="button" variant="secondary" size="sm" className="max-md:min-h-11" onClick={onStartPlacing}>
                📍 {el.collab.comments.pin}
              </Button>
              {canAnchorToSelection && (
                <Button type="button" variant="secondary" size="sm" className="max-md:min-h-11" onClick={onAnchorToSelection}>
                  {el.collab.comments.anchoredToSelection}
                </Button>
              )}
            </>
          )}
          <Button
            type="button"
            size="sm"
            className="ml-auto max-md:min-h-11"
            disabled={!draft.trim() || busy}
            onClick={() => void submit()}
          >
            {el.collab.comments.send}
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {visible.length === 0 && <p className="py-4 text-center text-sm text-muted">{el.collab.comments.none}</p>}
        <ul className="flex flex-col divide-y divide-hairline">
          {visible.map((root) => (
            <Thread
              key={root.id}
              root={root}
              replies={replies.get(root.id) ?? []}
              focused={focusedId === root.id}
              nameOf={nameOf}
              canResolve={canEdit || root.author_id === meId}
              canManage={canManage}
              names={names}
              meId={meId}
              onReply={(body) => onCreate(body, null, root.id)}
              onResolve={onResolve}
              onDelete={(id) => void confirmDelete(id)}
              onFocus={onFocus}
            />
          ))}
        </ul>
        {resolvedCount > 0 && (
          <button
            type="button"
            onClick={() => setShowResolved((v) => !v)}
            className="mt-3 min-h-10 w-full text-center text-xs text-muted hover:bg-hover hover:text-ink max-md:min-h-11"
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
  canManage,
  names,
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
  canManage: boolean;
  names: string[];
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
      className={cn(
        "border-l-2 py-3 pr-1 pl-2.5 text-sm text-ink",
        focused ? "border-l-navy bg-hover" : "border-l-transparent",
        root.resolved_at && "opacity-60",
      )}
    >
      <CommentBody
        comment={root}
        nameOf={nameOf}
        names={names}
        canDelete={root.author_id === meId || canManage}
        onDelete={onDelete}
      />
      {replies.map((r) => (
        <div key={r.id} className="mt-2 border-l border-hairline pl-2.5">
          <CommentBody
            comment={r}
            nameOf={nameOf}
            names={names}
            canDelete={r.author_id === meId || canManage}
            onDelete={onDelete}
          />
        </div>
      ))}
      <div className="mt-2 flex items-center gap-1.5">
        <Input
          value={reply}
          onChange={(e) => setReply(e.target.value)}
          placeholder={el.collab.comments.replyPlaceholder}
          maxLength={4000}
          className="min-h-9 min-w-0 flex-1 px-2 py-1 text-base sm:text-small max-md:min-h-11"
          onKeyDown={async (e) => {
            if (e.key === "Enter" && reply.trim()) {
              if (await onReply(reply.trim())) setReply("");
            }
          }}
        />
        {anchored && (
          <button
            type="button"
            className="inline-flex min-h-9 min-w-9 items-center justify-center text-xs text-muted hover:bg-hover hover:text-ink max-md:min-h-11 max-md:min-w-11"
            onClick={() => onFocus(root)}
            aria-label={el.collab.comments.showOnBoard}
          >
            📍
          </button>
        )}
        {canResolve && (
          <button
            type="button"
            className="inline-flex min-h-9 items-center px-2 text-xs font-medium text-navy hover:bg-hover max-md:min-h-11"
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
  names,
  canDelete,
  onDelete,
}: {
  comment: BoardComment;
  nameOf: (id: string | null) => string;
  names: string[];
  canDelete: boolean;
  onDelete: (id: string) => void;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 text-xs text-muted">
        <span className="font-medium text-ink">{nameOf(comment.author_id)}</span>
        <span className="flex items-center gap-1.5">
          {timeFormatter.format(new Date(comment.created_at))}
          {canDelete && (
            <button
              type="button"
              className="-my-2 flex h-9 w-9 items-center justify-center text-base text-muted hover:bg-negative-tint hover:text-negative max-md:h-11 max-md:w-11"
              onClick={() => onDelete(comment.id)}
              aria-label={el.collab.comments.delete}
              title={el.collab.comments.delete}
            >
              ×
            </button>
          )}
        </span>
      </div>
      <p className="mt-0.5 whitespace-pre-wrap break-words">
        <MentionText body={comment.body} names={names} />
      </p>
    </div>
  );
}
