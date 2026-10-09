"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { el } from "@/lib/i18n/el";
import { fillText } from "@/lib/collab/text";
import { BOARD_TEMPLATES, type BoardTemplate } from "@/lib/collab/templates";
import { canTrashBoard, trashDaysLeft } from "@/lib/collab/trash";
import { SubmitButton } from "@/components/SubmitButton";
import { createBoard, deleteBoardForever, renameBoard, restoreBoard, trashBoard } from "@/app/(collab)/collab/[projectId]/actions";
import { ToastStack, useConfirm, useToasts } from "../feedback";

export interface BoardCard {
  id: string;
  title: string;
  updated_at: string;
  created_by: string | null;
  deleted_at: string | null;
  thumbnailUrl: string | null;
}

const dateTime = new Intl.DateTimeFormat("el-GR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

const TEMPLATE_ICON: Record<BoardTemplate, string> = {
  blank: "⬜",
  brainstorm: "💡",
  moodboard: "🎨",
  review: "📐",
  todo: "✅",
};

// The project's boards as a card grid (thumbnail, inline rename, «Διαγραφή»
// to the trash with an undo), «Νέος πίνακας» with templates, and the «Κάδος».
export function ProjectBoards({
  projectId,
  boards,
  meId,
  canEdit,
  canManage,
}: {
  projectId: string;
  boards: BoardCard[];
  meId: string;
  canEdit: boolean;
  canManage: boolean;
}) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState<{ id: string; title: string } | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [showTrash, setShowTrash] = useState(false);
  const [pending, startTransition] = useTransition();
  const { toasts, push, dismiss } = useToasts();
  const { confirm, dialog } = useConfirm();

  const live = boards.filter((b) => !b.deleted_at);
  const trash = boards.filter((b) => b.deleted_at);
  const me = { userId: meId, canManage };

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, done?: string, undo?: () => void) =>
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) {
        push({ message: res.error ?? el.collab.board.saveError, tone: "error" });
        return;
      }
      if (done) push({ message: done, action: undo ? { label: el.collab.confirm.undo, run: undo } : undefined });
      router.refresh();
    });

  const trashIt = async (b: BoardCard) => {
    setMenuFor(null);
    if (!(await confirm({ message: fillText(el.collab.trash.confirmTrash, { title: b.title }), confirmLabel: el.collab.trash.moveToTrash })))
      return;
    run(
      () => trashBoard(projectId, b.id),
      el.collab.trash.moved,
      () => run(() => restoreBoard(projectId, b.id), el.collab.trash.restored),
    );
  };

  return (
    <section aria-labelledby="boards-heading">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 id="boards-heading" className="text-base font-semibold">
          {el.collab.boards}
        </h2>
        {canEdit && (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="flex min-h-11 items-center gap-1 rounded-lg bg-ink px-4 text-sm font-medium text-white hover:bg-ink/85"
          >
            + {el.collab.newBoard}
          </button>
        )}
      </div>

      {live.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-line-strong bg-surface px-4 py-10 text-center">
          <span className="text-4xl" aria-hidden="true">
            🗂️
          </span>
          <h3 className="font-semibold">{canEdit ? el.collab.project.emptyBoardsTitle : el.collab.noBoards}</h3>
          <p className="max-w-md text-sm text-ink-muted">{canEdit ? el.collab.project.emptyBoardsHint : el.collab.project.emptyBoardsGuest}</p>
          {canEdit && (
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="min-h-11 rounded-lg bg-ink px-5 text-sm font-medium text-white hover:bg-ink/85"
            >
              + {el.collab.newBoard}
            </button>
          )}
        </div>
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {live.map((b) => {
            const mayTrash = canTrashBoard(b, me);
            return (
              <li key={b.id} className="group relative flex flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-sm transition-shadow hover:shadow-md">
                <Link href={`/collab/${projectId}/board/${b.id}`} className="block aspect-[16/10] bg-bg" aria-label={`${el.collab.project.openBoard}: ${b.title}`}>
                  {b.thumbnailUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL from the private bucket
                    <img src={b.thumbnailUrl} alt="" className="h-full w-full object-contain" loading="lazy" />
                  ) : (
                    <div className="flex h-full items-center justify-center text-xs text-ink-faint">{el.collab.project.noThumbnail}</div>
                  )}
                </Link>
                <div className="flex items-start gap-1 p-3">
                  <div className="min-w-0 flex-1">
                    {renaming?.id === b.id ? (
                      <form
                        className="flex gap-1"
                        onSubmit={(e) => {
                          e.preventDefault();
                          const title = renaming.title;
                          setRenaming(null);
                          run(() => renameBoard(projectId, b.id, title));
                        }}
                      >
                        <input
                          value={renaming.title}
                          onChange={(e) => setRenaming({ id: b.id, title: e.target.value })}
                          maxLength={200}
                          autoFocus
                          aria-label={el.collab.boardTitle}
                          className="min-h-11 min-w-0 flex-1 rounded-lg border border-line-strong px-2 text-base sm:text-sm"
                          onKeyDown={(e) => e.key === "Escape" && setRenaming(null)}
                        />
                        <button type="submit" className="min-h-11 rounded-lg bg-ink px-3 text-sm text-white">
                          {el.collab.project.renameSave}
                        </button>
                      </form>
                    ) : (
                      <Link href={`/collab/${projectId}/board/${b.id}`} className="block truncate font-medium hover:underline">
                        {b.title}
                      </Link>
                    )}
                    <div className="mt-0.5 text-xs text-ink-faint">
                      {el.collab.project.updated} {dateTime.format(new Date(b.updated_at))}
                    </div>
                  </div>
                  {(canEdit || mayTrash) && renaming?.id !== b.id && (
                    <div className="relative">
                      <button
                        type="button"
                        aria-label={el.collab.project.moreActions}
                        aria-expanded={menuFor === b.id}
                        className="flex h-11 w-11 items-center justify-center rounded-lg text-lg text-ink-muted hover:bg-bg"
                        onClick={() => setMenuFor((id) => (id === b.id ? null : b.id))}
                      >
                        ⋯
                      </button>
                      {menuFor === b.id && (
                        <div className="absolute right-0 bottom-12 z-20 flex w-48 flex-col rounded-lg border border-line bg-surface py-1 text-sm shadow-lg">
                          {canEdit && (
                            <button
                              type="button"
                              className="min-h-11 px-3 text-left hover:bg-bg"
                              onClick={() => {
                                setMenuFor(null);
                                setRenaming({ id: b.id, title: b.title });
                              }}
                            >
                              ✏️ {el.collab.project.rename}
                            </button>
                          )}
                          {mayTrash && (
                            <button type="button" className="min-h-11 px-3 text-left text-red-ink hover:bg-red-bg" onClick={() => void trashIt(b)}>
                              🗑️ {el.collab.trash.moveToTrash}
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {trash.length > 0 && (
        <div className="mt-4 rounded-xl border border-line bg-surface">
          <button
            type="button"
            className="flex min-h-12 w-full items-center justify-between px-4 text-sm font-medium"
            aria-expanded={showTrash}
            onClick={() => setShowTrash((v) => !v)}
          >
            <span>
              🗑️ {el.collab.trash.title} ({trash.length})
            </span>
            <span aria-hidden="true">{showTrash ? "▲" : "▼"}</span>
          </button>
          {showTrash && (
            <div className="border-t border-line px-4 py-3">
              <p className="mb-2 text-xs text-ink-muted">{el.collab.trash.hint}</p>
              <ul className="flex flex-col divide-y divide-line/60">
                {trash.map((b) => {
                  const days = trashDaysLeft(b.deleted_at as string);
                  const may = canTrashBoard(b, me);
                  return (
                    <li key={b.id} className="flex flex-wrap items-center gap-2 py-2">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">{b.title}</div>
                        <div className="text-xs text-ink-faint">
                          {days > 0 ? fillText(el.collab.trash.daysLeft, { days }) : el.collab.trash.lastDay}
                        </div>
                      </div>
                      {may && (
                        <>
                          <button
                            type="button"
                            disabled={pending}
                            className="min-h-11 rounded-lg border border-line-strong px-3 text-sm hover:bg-bg disabled:opacity-50"
                            onClick={() => run(() => restoreBoard(projectId, b.id), el.collab.trash.restored)}
                          >
                            ↩ {el.collab.trash.restore}
                          </button>
                          <button
                            type="button"
                            disabled={pending}
                            className="min-h-11 rounded-lg px-3 text-sm text-red-ink hover:bg-red-bg disabled:opacity-50"
                            onClick={async () => {
                              if (
                                await confirm({
                                  message: fillText(el.collab.trash.confirmForever, { title: b.title }),
                                  confirmLabel: el.collab.trash.deleteForever,
                                })
                              )
                                run(() => deleteBoardForever(projectId, b.id));
                            }}
                          >
                            {el.collab.trash.deleteForever}
                          </button>
                        </>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>
      )}

      {creating && <NewBoardDialog projectId={projectId} onClose={() => setCreating(false)} />}
      {dialog}
      <ToastStack toasts={toasts} onDismiss={dismiss} className="fixed inset-x-0 bottom-4 z-[70] px-2" />
    </section>
  );
}

function NewBoardDialog({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const [template, setTemplate] = useState<BoardTemplate>("blank");
  const t = el.collab.templates;
  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-ink/30 sm:items-center sm:p-3" onClick={onClose} role="presentation">
      <form
        action={createBoard.bind(null, projectId)}
        role="dialog"
        aria-modal="true"
        aria-label={el.collab.project.newBoardTitle}
        className="flex max-h-[92dvh] w-full max-w-lg flex-col overflow-y-auto rounded-t-2xl bg-surface p-4 shadow-2xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{el.collab.project.newBoardTitle}</h2>
          <button type="button" onClick={onClose} className="flex h-11 w-11 items-center justify-center rounded-lg text-xl text-ink-muted hover:bg-bg" aria-label={el.collab.comments.close}>
            ×
          </button>
        </div>
        <label className="mb-1 text-xs font-medium text-ink-muted" htmlFor="new-board-title">
          {el.collab.boardTitle}
        </label>
        <input
          id="new-board-title"
          name="title"
          maxLength={200}
          autoFocus
          placeholder={template === "blank" ? el.collab.boardTitle : t[template].name}
          className="mb-4 min-h-11 rounded-lg border border-line-strong px-3 text-base sm:text-sm"
        />
        <input type="hidden" name="template" value={template} />
        <fieldset>
          <legend className="mb-2 text-xs font-medium text-ink-muted">{el.collab.project.chooseTemplate}</legend>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {BOARD_TEMPLATES.map((key) => (
              <button
                key={key}
                type="button"
                aria-pressed={template === key}
                onClick={() => setTemplate(key)}
                className={`flex min-h-16 items-start gap-3 rounded-xl border p-3 text-left ${
                  template === key ? "border-ink bg-sage/40 ring-1 ring-ink" : "border-line hover:bg-bg"
                }`}
              >
                <span className="text-2xl" aria-hidden="true">
                  {TEMPLATE_ICON[key]}
                </span>
                <span>
                  <span className="block text-sm font-medium">{t[key].name}</span>
                  <span className="block text-xs text-ink-muted">{t[key].hint}</span>
                </span>
              </button>
            ))}
          </div>
        </fieldset>
        <SubmitButton className="mt-4 min-h-12 w-full text-base" pendingLabel={el.collab.project.creating}>
          {el.collab.project.create}
        </SubmitButton>
      </form>
    </div>
  );
}
