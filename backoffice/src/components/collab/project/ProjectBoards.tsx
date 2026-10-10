"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { el } from "@/lib/i18n/el";
import { fillText } from "@/lib/collab/text";
import { BOARD_TEMPLATES, type BoardTemplate } from "@/lib/collab/templates";
import { canTrashBoard, trashDaysLeft } from "@/lib/collab/trash";
import { SubmitButton } from "@/components/SubmitButton";
import { Button, Drawer, Input, Label, MenuItem, SectionHeader, cn } from "@/components/ui";
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

// The project's boards as a grid of square-cornered tiles (thumbnail in a
// hairline frame, title and date under it, inline rename, «Διαγραφή» to the
// trash with an undo), «Νέος πίνακας» with templates in a drawer, and the
// «Κάδος».
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

  const newBoardButton = (
    <Button type="button" size="sm" className="max-md:min-h-11" onClick={() => setCreating(true)}>
      + {el.collab.newBoard}
    </Button>
  );

  return (
    <section aria-labelledby="boards-heading" className="flex flex-col gap-4">
      <SectionHeader title={<span id="boards-heading">{el.collab.boards}</span>} actions={canEdit && live.length > 0 ? newBoardButton : undefined} />

      {live.length === 0 ? (
        // EmptyState's look without its top hairline (the section header
        // already draws one right above).
        <div className="flex flex-col items-start gap-2 border-b border-hairline pt-2 pb-8">
          <p className="text-body text-ink">{canEdit ? el.collab.project.emptyBoardsTitle : el.collab.noBoards}</p>
          <p className="max-w-prose text-small text-muted">
            {canEdit ? el.collab.project.emptyBoardsHint : el.collab.project.emptyBoardsGuest}
          </p>
          {canEdit && <div className="mt-2">{newBoardButton}</div>}
        </div>
      ) : (
        <ul className="grid grid-cols-1 gap-x-6 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
          {live.map((b) => {
            const mayTrash = canTrashBoard(b, me);
            return (
              <li key={b.id} className="flex min-w-0 flex-col gap-2">
                <Link
                  href={`/collab/${projectId}/board/${b.id}`}
                  className="block aspect-[16/10] border border-hairline bg-field transition-colors hover:border-navy"
                  aria-label={`${el.collab.project.openBoard}: ${b.title}`}
                >
                  {b.thumbnailUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL from the private bucket
                    <img src={b.thumbnailUrl} alt="" className="h-full w-full object-contain" loading="lazy" />
                  ) : (
                    <div className="flex h-full items-center justify-center px-3 text-center text-xs text-muted">{el.collab.project.noThumbnail}</div>
                  )}
                </Link>
                <div className="flex items-start gap-1">
                  <div className="min-w-0 flex-1">
                    {renaming?.id === b.id ? (
                      <form
                        className="flex gap-1.5"
                        onSubmit={(e) => {
                          e.preventDefault();
                          const title = renaming.title;
                          setRenaming(null);
                          run(() => renameBoard(projectId, b.id, title));
                        }}
                      >
                        <Input
                          value={renaming.title}
                          onChange={(e) => setRenaming({ id: b.id, title: e.target.value })}
                          maxLength={200}
                          autoFocus
                          aria-label={el.collab.boardTitle}
                          className="min-w-0 flex-1 max-md:min-h-11 max-md:text-base"
                          onKeyDown={(e) => e.key === "Escape" && setRenaming(null)}
                        />
                        <Button type="submit" className="max-md:min-h-11">
                          {el.collab.project.renameSave}
                        </Button>
                      </form>
                    ) : (
                      <Link
                        href={`/collab/${projectId}/board/${b.id}`}
                        className="block truncate text-body text-ink underline-offset-4 hover:underline"
                      >
                        {b.title}
                      </Link>
                    )}
                    <p className="mt-0.5 text-small text-muted">
                      {el.collab.project.updated} <span className="num">{dateTime.format(new Date(b.updated_at))}</span>
                    </p>
                  </div>
                  {(canEdit || mayTrash) && renaming?.id !== b.id && (
                    <div className="relative shrink-0">
                      <button
                        type="button"
                        aria-label={el.collab.project.moreActions}
                        aria-haspopup="menu"
                        aria-expanded={menuFor === b.id}
                        className="-mr-2 flex h-10 w-10 items-center justify-center text-lg leading-none text-muted hover:bg-hover hover:text-ink max-md:h-11 max-md:w-11"
                        onClick={() => setMenuFor((id) => (id === b.id ? null : b.id))}
                      >
                        <span aria-hidden="true">⋯</span>
                      </button>
                      {menuFor === b.id && (
                        <div role="menu" className="absolute top-full right-0 z-20 mt-1 flex min-w-52 flex-col border border-hairline bg-field py-1">
                          {canEdit && (
                            <MenuItem
                              onClick={() => {
                                setMenuFor(null);
                                setRenaming({ id: b.id, title: b.title });
                              }}
                            >
                              {el.collab.project.rename}
                            </MenuItem>
                          )}
                          {mayTrash && (
                            <MenuItem tone="danger" onClick={() => void trashIt(b)}>
                              {el.collab.trash.moveToTrash}
                            </MenuItem>
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
        <div className="border-y border-hairline">
          <button
            type="button"
            className="flex min-h-12 w-full items-center justify-between gap-3 text-left text-sm text-text hover:text-ink"
            aria-expanded={showTrash}
            onClick={() => setShowTrash((v) => !v)}
          >
            <span>
              {el.collab.trash.title} <span className="num text-muted">({trash.length})</span>
            </span>
            <span aria-hidden="true" className="text-xs text-muted">
              {showTrash ? "▲" : "▼"}
            </span>
          </button>
          {showTrash && (
            <div className="border-t border-hairline pt-3 pb-1">
              <p className="mb-1 text-small text-muted">{el.collab.trash.hint}</p>
              <ul className="flex flex-col">
                {trash.map((b) => {
                  const days = trashDaysLeft(b.deleted_at as string);
                  const may = canTrashBoard(b, me);
                  return (
                    <li key={b.id} className="flex flex-wrap items-center gap-2 border-t border-hairline py-2.5 first:border-t-0">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm text-ink">{b.title}</p>
                        <p className="text-small text-muted">
                          {days > 0 ? fillText(el.collab.trash.daysLeft, { days }) : el.collab.trash.lastDay}
                        </p>
                      </div>
                      {may && (
                        <div className="flex flex-wrap gap-2">
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            className="max-md:min-h-11"
                            disabled={pending}
                            onClick={() => run(() => restoreBoard(projectId, b.id), el.collab.trash.restored)}
                          >
                            {el.collab.trash.restore}
                          </Button>
                          <Button
                            type="button"
                            variant="danger"
                            size="sm"
                            className="max-md:min-h-11"
                            disabled={pending}
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
                          </Button>
                        </div>
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

// «Νέος πίνακας» in a drawer (full screen on phones). A plain <form action>
// rather than FormDrawer: createBoard redirects to the new board, which a
// form action handles natively.
function NewBoardDialog({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const [template, setTemplate] = useState<BoardTemplate>("blank");
  const t = el.collab.templates;
  return (
    <Drawer onClose={onClose} title={el.collab.project.newBoardTitle} closeOnBackdrop={false}>
      <form action={createBoard.bind(null, projectId)} className="flex flex-col gap-5">
        <div className="flex flex-col">
          <Label htmlFor="new-board-title">{el.collab.boardTitle}</Label>
          <Input
            id="new-board-title"
            name="title"
            maxLength={200}
            autoFocus
            placeholder={template === "blank" ? el.collab.boardTitle : t[template].name}
            className="max-md:min-h-11 max-md:text-base"
          />
        </div>
        <input type="hidden" name="template" value={template} />
        <fieldset>
          <legend className="mb-1 text-xs font-medium text-muted">{el.collab.project.chooseTemplate}</legend>
          <div className="flex flex-col border-t border-hairline">
            {BOARD_TEMPLATES.map((key) => (
              <button
                key={key}
                type="button"
                aria-pressed={template === key}
                onClick={() => setTemplate(key)}
                className={cn(
                  "flex min-h-14 flex-col justify-center border-b border-l-2 border-b-hairline px-3 py-2.5 text-left transition-colors",
                  template === key ? "border-l-navy bg-hover" : "border-l-transparent hover:bg-hover",
                )}
              >
                <span className={cn("block text-sm", template === key ? "font-medium text-ink" : "text-ink")}>{t[key].name}</span>
                <span className="block text-small text-muted">{t[key].hint}</span>
              </button>
            ))}
          </div>
        </fieldset>
        <div className="sticky bottom-0 -mx-5 mt-2 flex justify-end gap-2 border-t border-hairline bg-raised px-5 py-4 md:-mx-8 md:px-8">
          <Button type="button" variant="secondary" className="max-md:min-h-11" onClick={onClose}>
            {el.common.cancel}
          </Button>
          <SubmitButton className="max-md:min-h-11" pendingLabel={el.collab.project.creating}>
            {el.collab.project.create}
          </SubmitButton>
        </div>
      </form>
    </Drawer>
  );
}
