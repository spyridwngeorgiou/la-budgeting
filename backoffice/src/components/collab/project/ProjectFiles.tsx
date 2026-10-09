"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { el } from "@/lib/i18n/el";
import { fillText, formatBytes } from "@/lib/collab/text";
import { canDeleteFile } from "@/lib/collab/trash";
import { createClient } from "@/lib/supabase/client";
import { deleteCollabFile } from "@/app/(collab)/collab/[projectId]/actions";
import { COLLAB_FILE_TYPES, isAllowedCollabFile, isImageType, uploadBoardFile } from "../boardFiles";
import { ToastStack, useConfirm, useToasts } from "../feedback";

export interface FileRow {
  id: string;
  original_name: string | null;
  mime_type: string;
  size_bytes: number;
  created_at: string;
  created_by: string | null;
  board_id: string | null;
}

const t = el.collab.fileLibrary;
const dateFmt = new Intl.DateTimeFormat("el-GR", { day: "2-digit", month: "2-digit", year: "numeric" });
const PREVIEW_COUNT = 12;

// The project's Files card: drag-and-drop (or pick) uploads as project files
// (0060: board_id null, <org>/<project>/shared/), image thumbnails / a PDF
// icon, and delete for the uploader, a lead or an org editor.
export function ProjectFiles({
  projectId,
  orgId,
  files,
  meId,
  canEdit,
  canManage,
  boardTitles,
}: {
  projectId: string;
  orgId: string;
  files: FileRow[];
  meId: string;
  canEdit: boolean;
  canManage: boolean;
  boardTitles: Record<string, string>;
}) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [, startTransition] = useTransition();
  const { toasts, push, dismiss } = useToasts();
  const { confirm, dialog } = useConfirm();

  async function upload(list: FileList | File[]) {
    const all = Array.from(list);
    const ok = all.filter((f) => isAllowedCollabFile(f.type, f.size));
    if (ok.length < all.length) push({ message: el.collab.board.unsupportedFile, tone: "error" });
    if (ok.length === 0) return;
    let failed = 0;
    for (let i = 0; i < ok.length; i++) {
      setProgress({ done: i, total: ok.length });
      try {
        await uploadBoardFile(supabase, { orgId, projectId, boardId: null }, {
          fileId: crypto.randomUUID(),
          blob: ok[i],
          mimeType: ok[i].type,
          name: ok[i].name,
        });
      } catch {
        failed += 1;
      }
    }
    setProgress(null);
    push(failed > 0 ? { message: el.collab.board.uploadFailed, tone: "error" } : { message: t.uploaded });
    startTransition(() => router.refresh());
  }

  async function remove(f: FileRow) {
    const name = f.original_name || f.mime_type;
    if (!(await confirm({ message: fillText(t.confirmDelete, { name }) }))) return;
    const res = await deleteCollabFile(projectId, f.id);
    if (!res.ok) push({ message: res.error, tone: "error" });
    else {
      push({ message: t.deleted });
      startTransition(() => router.refresh());
    }
  }

  const visible = showAll ? files : files.slice(0, PREVIEW_COUNT);

  return (
    <section
      aria-labelledby="files-heading"
      className={`rounded-xl border bg-surface p-4 ${over ? "border-sage-strong ring-2 ring-sage-strong" : "border-line"}`}
      onDragOver={(e) => {
        if (!canEdit || !e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        if (!canEdit) return;
        e.preventDefault();
        setOver(false);
        if (e.dataTransfer.files.length) void upload(e.dataTransfer.files);
      }}
    >
      <h2 id="files-heading" className="mb-3 text-base font-semibold">
        {t.title}
      </h2>

      {canEdit && (
        <button
          type="button"
          onClick={() => input.current?.click()}
          disabled={!!progress}
          className="mb-3 flex min-h-20 w-full flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-line-strong bg-bg/50 px-3 py-3 text-center text-sm hover:bg-bg disabled:opacity-60"
        >
          {progress ? (
            <span className="flex items-center gap-2 font-medium">
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-ink/30 border-t-ink" aria-hidden="true" />
              {fillText(t.uploading, { done: progress.done + 1, total: progress.total })}
            </span>
          ) : (
            <>
              <span className="text-2xl" aria-hidden="true">
                ⬆️
              </span>
              <span>
                {t.dropHere} <span className="font-medium underline">{t.choose}</span>
              </span>
              <span className="text-xs text-ink-faint">{t.allowed}</span>
            </>
          )}
        </button>
      )}
      <input
        ref={input}
        type="file"
        multiple
        accept={COLLAB_FILE_TYPES.join(",")}
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.length) void upload(e.target.files);
          e.target.value = "";
        }}
      />

      {files.length === 0 ? (
        <p className="py-2 text-sm text-ink-faint">{el.collab.noFiles}</p>
      ) : (
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {visible.map((f) => {
            const href = `/collab/${projectId}/files/${f.id}`;
            const name = f.original_name || f.mime_type;
            const mayDelete = canDeleteFile(f, { userId: meId, canManage, canEdit });
            return (
              <li key={f.id} className="relative flex flex-col overflow-hidden rounded-lg border border-line">
                <a href={href} target="_blank" rel="noopener" className="flex aspect-[4/3] items-center justify-center bg-bg" title={name}>
                  {isImageType(f.mime_type) ? (
                    // eslint-disable-next-line @next/next/no-img-element -- access-checked redirect to a signed URL
                    <img src={href} alt="" loading="lazy" className="h-full w-full object-cover" />
                  ) : (
                    <span className="flex flex-col items-center text-red-ink">
                      <span className="text-3xl" aria-hidden="true">
                        📄
                      </span>
                      <span className="text-[11px] font-semibold">PDF</span>
                    </span>
                  )}
                </a>
                <div className="flex items-start gap-1 p-2">
                  <div className="min-w-0 flex-1">
                    <a href={href} target="_blank" rel="noopener" className="block truncate text-xs font-medium hover:underline">
                      {name}
                    </a>
                    <div className="truncate text-[11px] text-ink-faint">
                      {formatBytes(f.size_bytes)} · {dateFmt.format(new Date(f.created_at))}
                    </div>
                    <div className="truncate text-[11px] text-ink-faint">
                      {f.board_id ? `${t.onBoard}${boardTitles[f.board_id] ? ` «${boardTitles[f.board_id]}»` : ""}` : t.shared}
                    </div>
                  </div>
                  {mayDelete && (
                    <button
                      type="button"
                      onClick={() => void remove(f)}
                      aria-label={`${t.delete}: ${name}`}
                      title={t.delete}
                      className="-mr-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-ink-faint hover:bg-red-bg hover:text-red-ink"
                    >
                      🗑️
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {files.length > PREVIEW_COUNT && !showAll && (
        <button type="button" onClick={() => setShowAll(true)} className="mt-2 min-h-11 w-full rounded-lg text-sm text-ink-muted hover:bg-bg">
          {t.showAll} ({files.length})
        </button>
      )}
      {dialog}
      <ToastStack toasts={toasts} onDismiss={dismiss} className="fixed inset-x-0 bottom-4 z-[70] px-2" />
    </section>
  );
}
