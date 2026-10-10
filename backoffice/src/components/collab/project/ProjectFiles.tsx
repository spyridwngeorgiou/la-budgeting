"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { el } from "@/lib/i18n/el";
import { fillText, formatBytes } from "@/lib/collab/text";
import { canDeleteFile } from "@/lib/collab/trash";
import { createClient } from "@/lib/supabase/client";
import { Button, SectionHeader, cn } from "@/components/ui";
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
      className={cn("flex flex-col gap-4", over && "outline-2 outline-offset-8 outline-navy")}
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
      <SectionHeader title={<span id="files-heading">{t.title}</span>} />

      {canEdit && (
        <button
          type="button"
          onClick={() => input.current?.click()}
          disabled={!!progress}
          className={cn(
            "flex min-h-20 w-full flex-col items-center justify-center gap-1 border border-dashed px-3 py-3 text-center text-sm text-text transition-colors hover:border-navy hover:bg-hover disabled:opacity-60",
            over ? "border-navy bg-hover" : "border-chip-border bg-field",
          )}
        >
          {progress ? (
            <span className="font-medium text-ink" aria-live="polite">
              {fillText(t.uploading, { done: progress.done + 1, total: progress.total })}
            </span>
          ) : (
            <>
              <span>
                {t.dropHere} <span className="font-medium text-ink underline underline-offset-4">{t.choose}</span>
              </span>
              <span className="text-xs text-muted">{t.allowed}</span>
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
        <p className="border-b border-hairline pb-4 text-sm text-muted">{el.collab.noFiles}</p>
      ) : (
        <ul className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3">
          {visible.map((f) => {
            const href = `/collab/${projectId}/files/${f.id}`;
            const name = f.original_name || f.mime_type;
            const mayDelete = canDeleteFile(f, { userId: meId, canManage, canEdit });
            return (
              <li key={f.id} className="flex min-w-0 flex-col gap-1.5">
                <a
                  href={href}
                  target="_blank"
                  rel="noopener"
                  className="flex aspect-[4/3] items-center justify-center border border-hairline bg-field transition-colors hover:border-navy"
                  title={name}
                >
                  {isImageType(f.mime_type) ? (
                    // eslint-disable-next-line @next/next/no-img-element -- access-checked redirect to a signed URL
                    <img src={href} alt="" loading="lazy" className="h-full w-full object-cover" />
                  ) : (
                    <span className="eyebrow text-negative">PDF</span>
                  )}
                </a>
                <div className="flex items-start gap-1">
                  <div className="min-w-0 flex-1">
                    <a
                      href={href}
                      target="_blank"
                      rel="noopener"
                      className="block truncate text-small text-ink underline-offset-4 hover:underline"
                    >
                      {name}
                    </a>
                    <p className="truncate text-xs text-muted">
                      <span className="num">{formatBytes(f.size_bytes)}</span> ·{" "}
                      <span className="num">{dateFmt.format(new Date(f.created_at))}</span>
                    </p>
                    <p className="truncate text-xs text-muted">
                      {f.board_id ? `${t.onBoard}${boardTitles[f.board_id] ? ` «${boardTitles[f.board_id]}»` : ""}` : t.shared}
                    </p>
                  </div>
                  {mayDelete && (
                    <button
                      type="button"
                      onClick={() => void remove(f)}
                      aria-label={`${t.delete}: ${name}`}
                      title={t.delete}
                      className="-mr-2 flex h-10 w-10 shrink-0 items-center justify-center text-muted hover:bg-negative-tint hover:text-negative max-md:h-11 max-md:w-11"
                    >
                      <TrashIcon />
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {files.length > PREVIEW_COUNT && !showAll && (
        <Button type="button" variant="ghost" className="w-full max-md:min-h-11" onClick={() => setShowAll(true)}>
          {t.showAll} <span className="num text-muted">({files.length})</span>
        </Button>
      )}
      {dialog}
      <ToastStack toasts={toasts} onDismiss={dismiss} className="fixed inset-x-0 bottom-4 z-[70] px-2" />
    </section>
  );
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-4 w-4" aria-hidden="true">
      <path d="M2.5 4h11M6 4V2.5h4V4M4 4l.7 9.5h6.6L12 4M6.8 6.5v4.5M9.2 6.5v4.5" />
    </svg>
  );
}
