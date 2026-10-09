"use client";

import "@excalidraw/excalidraw/index.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Excalidraw, MainMenu } from "@excalidraw/excalidraw";
import type { BinaryFileData, BinaryFiles, DataURL, ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { ExcalidrawElement, FileId, OrderedExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { createClient } from "@/lib/supabase/client";
import { el } from "@/lib/i18n/el";
import { useBoardSync, type CommentEvent, type SyncStatus } from "./useBoardSync";
import { dataUrlToBlob, isAllowedCollabFile, loadBoardFiles, uploadBoardFile, COLLAB_FILE_TYPES } from "./boardFiles";
import { StickyNoteButton, insertSkeletons, viewportCenter } from "./StickyNoteButton";
import { CommentsLayer } from "./CommentsLayer";
import { CommentsPanel, type CommentAnchor } from "./CommentsPanel";
import { AiPanel } from "./AiPanel";
import { AiSpark } from "@/components/ui";
import { COMMENT_COLUMNS, type BoardBootstrap, type BoardComment } from "./types";

// Side-panel registry. One panel is open at a time: a right-hand drawer on
// desktop, a bottom sheet on phones. The board assistant (AiPanel) needs
// the same `api` handle (to place generated elements via insertSkeletons)
// that comments use, which is why panels live inside the canvas component
// rather than in the server page.
type PanelId = "comments" | "ai";

const STATUS_LABEL: Record<SyncStatus, string> = {
  connecting: el.collab.board.loading,
  live: el.collab.board.saved,
  saving: el.collab.board.saving,
  saved: el.collab.board.saved,
  offline: el.collab.board.offline,
  error: el.collab.board.saveError,
};

const MAX_FILE_RETRIES = 5;

export default function BoardCanvas({ bootstrap }: { bootstrap: BoardBootstrap }) {
  const { boardId, projectId, orgId, canEdit, me } = bootstrap;
  const supabase = useMemo(() => createClient(), []);
  const scope = useMemo(() => ({ orgId, projectId, boardId }), [orgId, projectId, boardId]);

  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null);
  const [comments, setComments] = useState<BoardComment[]>(bootstrap.comments);
  const [panel, setPanel] = useState<PanelId | null>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [placing, setPlacing] = useState(false);
  const [draftAnchor, setDraftAnchor] = useState<CommentAnchor | null>(null);
  const [hasSelection, setHasSelection] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  // fileIds already uploaded or fetched (or in flight), so onChange's
  // `files` map doesn't re-trigger work; plus retry counts for images whose
  // bytes a peer is still uploading.
  const [handledFiles] = useState(() => new Set<string>());
  const [fileRetries] = useState(() => new Map<string, number>());

  const initialData = useMemo(
    () => ({
      elements: bootstrap.elements as ExcalidrawElement[],
      appState: { viewBackgroundColor: "#ffffff" },
      scrollToContent: true,
    }),
    [bootstrap.elements],
  );

  const toast = useCallback((message: string) => api?.setToast({ message, closable: true, duration: 4000 }), [api]);

  // ---- files ------------------------------------------------------------
  // Retries re-enter ensureFiles through a ref: a useCallback can't name itself.
  const ensureFilesRef = useRef<(elements: readonly ExcalidrawElement[]) => Promise<void>>(() => Promise.resolve());
  const ensureFiles = useCallback(
    async (elements: readonly { type: string; fileId?: string | null; isDeleted?: boolean }[]) => {
      if (!api) return;
      const present = api.getFiles();
      const missing = [
        ...new Set(
          elements
            .filter((e) => e.type === "image" && !e.isDeleted && e.fileId && !present[e.fileId] && !handledFiles.has(e.fileId))
            .map((e) => e.fileId as string),
        ),
      ];
      if (missing.length === 0) return;
      missing.forEach((id) => handledFiles.add(id));
      const loaded = await loadBoardFiles(supabase, boardId, missing);
      if (loaded.length > 0) api.addFiles(loaded);
      const loadedIds = new Set(loaded.map((f) => f.id as string));
      const retry = missing.filter((id) => !loadedIds.has(id));
      for (const id of retry) {
        handledFiles.delete(id);
        const n = (fileRetries.get(id) ?? 0) + 1;
        fileRetries.set(id, n);
        if (n <= MAX_FILE_RETRIES) {
          window.setTimeout(() => void ensureFilesRef.current(api.getSceneElements()), 2000 * n);
        }
      }
    },
    [api, supabase, boardId, handledFiles, fileRetries],
  );
  useEffect(() => {
    ensureFilesRef.current = ensureFiles;
  }, [ensureFiles]);

  const uploadNewFiles = useCallback(
    (files: BinaryFiles) => {
      for (const [id, file] of Object.entries(files)) {
        if (handledFiles.has(id)) continue;
        handledFiles.add(id);
        void (async () => {
          try {
            const blob = await dataUrlToBlob(file.dataURL);
            if (!isAllowedCollabFile(file.mimeType, blob.size)) throw new Error("unsupported");
            await uploadBoardFile(supabase, scope, { fileId: id, blob, mimeType: file.mimeType });
          } catch (e) {
            toast(
              e instanceof Error && e.message === "unsupported"
                ? el.collab.board.unsupportedFile
                : el.collab.board.uploadFailed,
            );
          }
        })();
      }
    },
    [supabase, scope, handledFiles, toast],
  );

  // ---- comments ---------------------------------------------------------
  const upsertComment = useCallback((row: BoardComment) => {
    setComments((list) => {
      const i = list.findIndex((c) => c.id === row.id);
      if (i === -1) return [...list, row];
      const next = list.slice();
      next[i] = row;
      return next;
    });
  }, []);

  const onCommentEvent = useCallback(
    ({ kind, record, old }: CommentEvent) => {
      if (kind === "delete") {
        const id = old?.id;
        if (typeof id === "string") setComments((list) => list.filter((c) => c.id !== id && c.parent_id !== id));
        return;
      }
      if (record && record.board_id === boardId) upsertComment(record as unknown as BoardComment);
    },
    [boardId, upsertComment],
  );

  const refetchComments = useCallback(async () => {
    const { data } = await supabase
      .from("board_comments")
      .select(COMMENT_COLUMNS)
      .eq("board_id", boardId)
      .order("created_at");
    if (data) setComments(data);
  }, [supabase, boardId]);

  const createComment = useCallback(
    async (body: string, anchor: CommentAnchor | null, parentId: string | null) => {
      const { data, error } = await supabase
        .from("board_comments")
        .insert({
          board_id: boardId,
          // Overwritten from the board by trigger; sent only to satisfy types.
          org_id: orgId,
          project_id: projectId,
          parent_id: parentId,
          body,
          element_id: anchor?.element_id ?? null,
          scene_x: anchor?.scene_x ?? null,
          scene_y: anchor?.scene_y ?? null,
        })
        .select(COMMENT_COLUMNS)
        .single();
      if (error || !data) {
        toast(error?.message ?? el.collab.board.saveError);
        return false;
      }
      upsertComment(data);
      if (!parentId) {
        setDraftAnchor(null);
        setFocusedId(data.id);
      }
      return true;
    },
    [supabase, boardId, orgId, projectId, toast, upsertComment],
  );

  const resolveComment = useCallback(
    async (id: string, resolved: boolean) => {
      const { data, error } = await supabase
        .from("board_comments")
        .update({ resolved_at: resolved ? new Date().toISOString() : null })
        .eq("id", id)
        .select(COMMENT_COLUMNS)
        .single();
      if (error || !data) toast(error?.message ?? el.collab.board.saveError);
      else upsertComment(data);
    },
    [supabase, toast, upsertComment],
  );

  const deleteComment = useCallback(
    async (id: string) => {
      const { error } = await supabase.from("board_comments").delete().eq("id", id);
      if (error) toast(error.message);
      else setComments((list) => list.filter((c) => c.id !== id && c.parent_id !== id));
    },
    [supabase, toast],
  );

  const focusComment = useCallback(
    (c: BoardComment) => {
      setFocusedId(c.id);
      if (!api) return;
      const target = c.element_id ? api.getSceneElements().find((e) => e.id === c.element_id) : undefined;
      if (target) {
        api.scrollToContent(target, { animate: true });
      } else if (c.scene_x !== null && c.scene_y !== null) {
        const s = api.getAppState();
        api.updateScene({
          appState: {
            scrollX: s.width / 2 / s.zoom.value - c.scene_x,
            scrollY: s.height / 2 / s.zoom.value - c.scene_y,
          },
        });
      }
    },
    [api],
  );

  // ---- sync -------------------------------------------------------------
  const { status, peerCount, handleChange, handlePointer } = useBoardSync({
    boardId,
    canEdit,
    me,
    initialElements: bootstrap.elements as { id: string; version: number }[],
    api,
    onRemoteElements: ensureFiles,
    onCommentEvent,
    onResync: refetchComments,
  });

  const onChange = useCallback(
    (elements: readonly OrderedExcalidrawElement[], appState: { selectedElementIds: Readonly<Record<string, true>> }, files: BinaryFiles) => {
      handleChange(elements);
      if (canEdit) uploadNewFiles(files);
      const selected = Object.keys(appState.selectedElementIds).length === 1;
      setHasSelection((prev) => (prev === selected ? prev : selected));
    },
    [handleChange, canEdit, uploadNewFiles],
  );

  const onApi = useCallback(
    (a: ExcalidrawImperativeAPI) => {
      setApi(a);
      // Images already on the board when it opened.
      const images = (bootstrap.elements as { type: string; fileId?: string | null; isDeleted?: boolean }[]).filter(
        (e) => e.type === "image",
      );
      if (images.length > 0) {
        // `api` state isn't set yet inside this callback; load directly.
        const ids = [...new Set(images.map((e) => e.fileId).filter((x): x is string => !!x))];
        ids.forEach((id) => handledFiles.add(id));
        void loadBoardFiles(supabase, boardId, ids).then((loaded) => loaded.length && a.addFiles(loaded));
      }
    },
    [bootstrap.elements, supabase, boardId, handledFiles],
  );

  // ---- attach (image or PDF from disk) ------------------------------------
  const onPickFile = useCallback(
    async (file: File) => {
      if (!api) return;
      if (!isAllowedCollabFile(file.type, file.size)) {
        toast(el.collab.board.unsupportedFile);
        return;
      }
      try {
        const fileId = crypto.randomUUID();
        handledFiles.add(fileId);
        const rowId = await uploadBoardFile(supabase, scope, {
          fileId,
          blob: file,
          mimeType: file.type,
          name: file.name,
        });
        const c = viewportCenter(api);
        if (file.type === "application/pdf") {
          // PDFs aren't drawable; place a linked card that opens the file.
          insertSkeletons(api, [
            {
              type: "rectangle",
              x: c.x - 140,
              y: c.y - 40,
              width: 280,
              height: 80,
              backgroundColor: "#e7f5ff",
              fillStyle: "solid",
              strokeColor: "#1971c2",
              strokeWidth: 1,
              roughness: 0,
              link: `/collab/${projectId}/files/${rowId}`,
              label: { text: `PDF · ${file.name}`.slice(0, 80), fontSize: 16 },
            },
          ]);
          return;
        }
        const dataURL = await new Promise<string>((resolve, reject) => {
          const r = new FileReader();
          r.onload = () => resolve(String(r.result));
          r.onerror = () => reject(r.error);
          r.readAsDataURL(file);
        });
        const size = await new Promise<{ w: number; h: number }>((resolve) => {
          const img = new Image();
          img.onload = () => resolve({ w: img.naturalWidth || 400, h: img.naturalHeight || 300 });
          img.onerror = () => resolve({ w: 400, h: 300 });
          img.src = dataURL;
        });
        const scale = Math.min(1, 600 / Math.max(size.w, size.h));
        api.addFiles([
          {
            id: fileId as FileId,
            dataURL: dataURL as DataURL,
            mimeType: file.type as BinaryFileData["mimeType"],
            created: Date.now(),
          },
        ]);
        insertSkeletons(api, [
          {
            type: "image",
            fileId: fileId as FileId,
            status: "saved",
            x: c.x - (size.w * scale) / 2,
            y: c.y - (size.h * scale) / 2,
            width: size.w * scale,
            height: size.h * scale,
          },
        ]);
      } catch {
        toast(el.collab.board.uploadFailed);
      }
    },
    [api, supabase, scope, projectId, handledFiles, toast],
  );

  const renderTopRightUI = useCallback(
    () => (
      <div className="flex items-center gap-1.5">
        {canEdit && api && <StickyNoteButton api={api} />}
        {canEdit && (
          <button
            type="button"
            className="flex h-9 items-center gap-1 rounded-lg border border-line-strong bg-surface px-2.5 text-xs font-medium text-ink shadow-sm hover:bg-bg"
            onClick={() => fileInput.current?.click()}
            title={el.collab.board.attachFile}
          >
            <span aria-hidden="true">📎</span>
            <span className="hidden sm:inline">{el.collab.board.attachFile}</span>
          </button>
        )}
        {bootstrap.ai && (
          <button
            type="button"
            className={`flex h-9 items-center gap-1 rounded-lg border px-2.5 text-xs font-medium shadow-sm ${
              panel === "ai" ? "border-ai-strong bg-ai-strong text-white" : "border-ai-border bg-ai-bg text-ai-ink hover:bg-ai-border/40"
            }`}
            onClick={() => setPanel((p) => (p === "ai" ? null : "ai"))}
            title={el.collabAi.title}
          >
            <AiSpark />
            <span className="hidden sm:inline">{el.collabAi.open}</span>
          </button>
        )}
        <button
          type="button"
          className={`flex h-9 items-center gap-1 rounded-lg border px-2.5 text-xs font-medium shadow-sm ${
            panel === "comments" ? "border-sage-strong bg-sage text-sage-ink" : "border-line-strong bg-surface text-ink hover:bg-bg"
          }`}
          onClick={() => setPanel((p) => (p === "comments" ? null : "comments"))}
          title={el.collab.comments.title}
        >
          <span aria-hidden="true">💬</span>
          {comments.filter((c) => !c.parent_id && !c.resolved_at).length || ""}
        </button>
      </div>
    ),
    [canEdit, api, panel, comments, bootstrap.ai],
  );

  return (
    <div className="flex h-full min-h-0 flex-col md:flex-row">
      <div className="relative min-h-0 flex-1">
        <Excalidraw
          excalidrawAPI={onApi}
          initialData={initialData}
          onChange={onChange}
          onPointerUpdate={handlePointer}
          isCollaborating
          viewModeEnabled={!canEdit}
          langCode="el-GR"
          theme="light"
          name={bootstrap.title}
          renderTopRightUI={renderTopRightUI}
          onLinkOpen={(element, event) => {
            // Our own file links open in a new tab through the access-
            // checked /files route; Excalidraw would otherwise navigate the
            // board tab away.
            const link = element.link;
            if (link && link.startsWith("/")) {
              event.preventDefault();
              window.open(link, "_blank", "noopener");
            }
          }}
          UIOptions={{
            canvasActions: {
              // Loading a file or clearing would replace the board for
              // everyone; keep those out of a shared space.
              loadScene: false,
              saveToActiveFile: false,
              clearCanvas: false,
              toggleTheme: false,
              changeViewBackgroundColor: canEdit,
            },
            tools: { image: canEdit },
          }}
        >
          <MainMenu>
            <MainMenu.DefaultItems.SaveAsImage />
            <MainMenu.DefaultItems.Help />
            <MainMenu.Separator />
            <MainMenu.ItemLink href={bootstrap.backHref}>{el.collab.board.back}</MainMenu.ItemLink>
          </MainMenu>
        </Excalidraw>

        {api && (
          <CommentsLayer
            api={api}
            comments={comments}
            placing={placing}
            onPlace={(p) => {
              setPlacing(false);
              setDraftAnchor({ element_id: null, scene_x: p.x, scene_y: p.y });
              setPanel("comments");
            }}
            onOpenThread={(id) => {
              setFocusedId(id);
              setPanel("comments");
            }}
          />
        )}

        <div className="pointer-events-none absolute bottom-3 left-1/2 z-[5] flex -translate-x-1/2 items-center gap-2 rounded-full bg-surface/90 px-3 py-1 text-[11px] text-ink-muted shadow-sm max-md:bottom-16">
          {!canEdit && <span className="font-medium text-amber-ink">{el.collab.viewOnly}</span>}
          <span className={status === "offline" || status === "error" ? "text-red-ink" : ""}>
            {STATUS_LABEL[status]}
          </span>
          {peerCount > 0 && (
            <span>
              · {peerCount + 1} {el.collab.board.online}
            </span>
          )}
        </div>

        <input
          ref={fileInput}
          type="file"
          accept={COLLAB_FILE_TYPES.join(",")}
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) void onPickFile(f);
          }}
        />
      </div>

      {panel && (
        <aside
          className={`flex min-h-0 flex-col border-line bg-surface max-md:fixed max-md:inset-x-0 max-md:bottom-0 max-md:z-20 max-md:max-h-[65dvh] max-md:rounded-t-xl max-md:border-t max-md:shadow-2xl md:border-l ${
            panel === "ai" ? "max-md:h-[65dvh] md:w-96" : "md:w-80"
          }`}
        >
          <div className="flex items-center justify-between border-b border-line px-3 py-2">
            <h2 className="flex items-center gap-1.5 text-sm font-medium">
              {panel === "ai" ? (
                <>
                  <AiSpark className="text-ai-ink" /> {el.collabAi.title}
                </>
              ) : (
                el.collab.comments.title
              )}
            </h2>
            <button
              type="button"
              className="rounded px-2 py-1 text-sm text-ink-muted hover:bg-bg"
              onClick={() => {
                setPanel(null);
                setPlacing(false);
              }}
              aria-label={el.collab.comments.close}
            >
              ×
            </button>
          </div>
          {panel === "ai" && bootstrap.ai ? (
            <AiPanel
              supabase={supabase}
              boardId={boardId}
              api={api}
              rights={bootstrap.ai}
              onToast={(message) => toast(message)}
            />
          ) : (
          <CommentsPanel
            comments={comments}
            people={bootstrap.people}
            meId={me.userId}
            canEdit={canEdit}
            focusedId={focusedId}
            draftAnchor={draftAnchor}
            canAnchorToSelection={canEdit && hasSelection}
            onStartPlacing={() => setPlacing(true)}
            onAnchorToSelection={() => {
              if (!api) return;
              const id = Object.keys(api.getAppState().selectedElementIds)[0];
              const target = api.getSceneElements().find((e) => e.id === id);
              if (target) setDraftAnchor({ element_id: target.id, scene_x: target.x + target.width, scene_y: target.y });
            }}
            onClearAnchor={() => setDraftAnchor(null)}
            onCreate={createComment}
            onResolve={(id, resolved) => void resolveComment(id, resolved)}
            onDelete={(id) => void deleteComment(id)}
            onFocus={focusComment}
          />
          )}
        </aside>
      )}

      {/* Visually-hidden fallback link for keyboard users who can't reach
          Excalidraw's menu. */}
      <Link href={bootstrap.backHref} className="sr-only focus:not-sr-only">
        {el.collab.board.back}
      </Link>
    </div>
  );
}
