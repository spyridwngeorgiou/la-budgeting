"use client";

import "@excalidraw/excalidraw/index.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  CaptureUpdateAction,
  Excalidraw,
  MainMenu,
  exportToBlob,
  newElementWith,
  viewportCoordsToSceneCoords,
} from "@excalidraw/excalidraw";
import type { BinaryFiles, ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { ExcalidrawElement, OrderedExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { createClient } from "@/lib/supabase/client";
import { el } from "@/lib/i18n/el";
import { fillText } from "@/lib/collab/text";
import { describeElements, duplicateElements, type LooseElement } from "@/lib/collab/elements";
import { NOTE_COLOURS, NOTE_SIZE, stickyNote, templateSkeletons, isBoardTemplate } from "@/lib/collab/templates";
import { AiSpark } from "@/components/ui";
import { deleteCollabFile } from "@/app/(collab)/collab/[projectId]/actions";
import { useBoardSync, type CommentEvent, type SyncStatus } from "./useBoardSync";
import { dataUrlToBlob, isAllowedCollabFile, loadBoardFiles, uploadBoardFile, COLLAB_FILE_TYPES } from "./boardFiles";
import { insertSkeletons, viewportCenter } from "./StickyNoteButton";
import { CommentsLayer } from "./CommentsLayer";
import { CommentsPanel, type CommentAnchor } from "./CommentsPanel";
import { AiPanel } from "./AiPanel";
import { TeamChat } from "./TeamChat";
import { useTeamChat } from "./useTeamChat";
import { QuickAddBar } from "./QuickAddBar";
import { SelectionToolbar, type SelectionInfo } from "./SelectionToolbar";
import { BoardTips, RemovedFilesLayer, ShortcutsHelp } from "./overlays";
import { ToastStack, useConfirm, useToasts } from "./feedback";
import { useCanvasUploads } from "./useCanvasUploads";
import { COMMENT_COLUMNS, type BoardBootstrap, type BoardComment } from "./types";

// Side panels. One is open at a time: a right-hand drawer on desktop, a
// bottom sheet on phones. «Συζήτηση» holds two tabs -- the project's team
// chat and the board assistant (which needs the Excalidraw `api` to place
// proposals, hence panels live inside the canvas component).
type PanelId = "comments" | "chat";
type ChatTab = "team" | "ai";

const STATUS_LABEL: Record<SyncStatus, string> = {
  connecting: el.collab.board.loading,
  live: el.collab.board.saved,
  saving: el.collab.board.saving,
  saved: el.collab.board.saved,
  offline: el.collab.board.offline,
  error: el.collab.board.saveError,
};

const MAX_FILE_RETRIES = 5;
// An image whose file row is missing and that is older than this was
// deleted, not "still uploading somewhere".
const MISSING_GRACE_MS = 60_000;
const THUMBNAIL_DELAY_MS = 8000;
const TOOLS_KEY = "collab:tools:expanded";

function readToolsExpanded() {
  try {
    return window.localStorage.getItem(TOOLS_KEY) === "1";
  } catch {
    return false;
  }
}

function isTypingTarget(t: EventTarget | null) {
  const node = t as HTMLElement | null;
  return !!node && (node.tagName === "INPUT" || node.tagName === "TEXTAREA" || node.isContentEditable);
}

export default function BoardCanvas({ bootstrap }: { bootstrap: BoardBootstrap }) {
  const { boardId, projectId, orgId, canEdit, canManage, me } = bootstrap;
  const supabase = useMemo(() => createClient(), []);
  const scope = useMemo(() => ({ orgId, projectId, boardId }), [orgId, projectId, boardId]);

  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null);
  const [comments, setComments] = useState<BoardComment[]>(bootstrap.comments);
  const [panel, setPanel] = useState<PanelId | null>(null);
  const [chatTab, setChatTab] = useState<ChatTab>("team");
  const [aiSeed, setAiSeed] = useState<{ key: number; text: string }>({ key: 0, text: "" });
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [placing, setPlacing] = useState(false);
  const [draftAnchor, setDraftAnchor] = useState<CommentAnchor | null>(null);
  const [hasSelection, setHasSelection] = useState(false);
  const [toolsExpanded, setToolsExpanded] = useState(readToolsExpanded);
  const [dragging, setDragging] = useState(false);
  const [help, setHelp] = useState(false);
  const [removedFiles, setRemovedFiles] = useState<ReadonlySet<string>>(() => new Set());
  const fileInput = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);

  const { toasts, push, dismiss } = useToasts();
  const { confirm, dialog } = useConfirm();
  const notify = useCallback((message: string, tone: "neutral" | "error" = "neutral") => push({ message, tone }), [push]);
  const notifyError = useCallback((message: string) => push({ message, tone: "error" }), [push]);

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

  const markRemoved = useCallback((ids: string[]) => {
    if (ids.length === 0) return;
    setRemovedFiles((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => next.add(id));
      return next;
    });
  }, []);

  // ---- files ------------------------------------------------------------
  // Retries re-enter ensureFiles through a ref: a useCallback can't name itself.
  const ensureFilesRef = useRef<(elements: readonly ExcalidrawElement[]) => Promise<void>>(() => Promise.resolve());
  const ensureFiles = useCallback(
    async (elements: readonly { type: string; fileId?: string | null; isDeleted?: boolean; updated?: number }[], a = api) => {
      if (!a) return;
      const present = a.getFiles();
      const images = elements.filter(
        (e) => e.type === "image" && !e.isDeleted && e.fileId && !present[e.fileId] && !handledFiles.has(e.fileId),
      );
      const missing = [...new Set(images.map((e) => e.fileId as string))];
      if (missing.length === 0) return;
      missing.forEach((id) => handledFiles.add(id));
      const { loaded, missing: noRow } = await loadBoardFiles(supabase, boardId, missing);
      if (loaded.length > 0) a.addFiles(loaded);
      const loadedIds = new Set(loaded.map((f) => f.id as string));
      const noRowSet = new Set(noRow);
      const now = Date.now();
      const gone: string[] = [];
      for (const id of missing.filter((x) => !loadedIds.has(x))) {
        const img = images.find((e) => e.fileId === id);
        const old = (img?.updated ?? now) < now - MISSING_GRACE_MS;
        const n = (fileRetries.get(id) ?? 0) + 1;
        fileRetries.set(id, n);
        if (noRowSet.has(id) && (old || n > MAX_FILE_RETRIES)) {
          gone.push(id);
          continue;
        }
        handledFiles.delete(id);
        if (n <= MAX_FILE_RETRIES) {
          window.setTimeout(() => void ensureFilesRef.current(a.getSceneElements()), 2000 * n);
        }
      }
      markRemoved(gone);
    },
    [api, supabase, boardId, handledFiles, fileRetries, markRemoved],
  );
  useEffect(() => {
    ensureFilesRef.current = (els) => ensureFiles(els);
  }, [ensureFiles]);

  // Images added through Excalidraw itself (its image tool): upload them.
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
            notifyError(
              e instanceof Error && e.message === "unsupported" ? el.collab.board.unsupportedFile : el.collab.board.uploadFailed,
            );
          }
        })();
      }
    },
    [supabase, scope, handledFiles, notifyError],
  );

  const uploads = useCanvasUploads({ api, supabase, scope, projectId, handledFiles, onError: notifyError });

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
    const { data } = await supabase.from("board_comments").select(COMMENT_COLUMNS).eq("board_id", boardId).order("created_at");
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
        notifyError(el.collab.board.saveError);
        return false;
      }
      upsertComment(data);
      if (!parentId) {
        setDraftAnchor(null);
        setFocusedId(data.id);
      }
      return true;
    },
    [supabase, boardId, orgId, projectId, notifyError, upsertComment],
  );

  const resolveComment = useCallback(
    async (id: string, resolved: boolean) => {
      const { data, error } = await supabase
        .from("board_comments")
        .update({ resolved_at: resolved ? new Date().toISOString() : null })
        .eq("id", id)
        .select(COMMENT_COLUMNS)
        .single();
      if (error || !data) notifyError(el.collab.board.saveError);
      else upsertComment(data);
    },
    [supabase, notifyError, upsertComment],
  );

  const deleteComment = useCallback(
    async (id: string) => {
      const { data, error } = await supabase.from("board_comments").delete().eq("id", id).select("id");
      if (error || !data?.length) notifyError(el.collab.board.saveError);
      else setComments((list) => list.filter((c) => c.id !== id && c.parent_id !== id));
    },
    [supabase, notifyError],
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
  const { status, peers, handleChange, handlePointer } = useBoardSync({
    boardId,
    canEdit,
    me,
    initialElements: bootstrap.elements as { id: string; version: number }[],
    api,
    onRemoteElements: ensureFiles,
    onCommentEvent,
    onResync: refetchComments,
  });

  // ---- team chat (kept alive for the unread badge) -------------------------
  const chat = useTeamChat({
    supabase,
    projectId,
    orgId,
    meId: me.userId,
    active: panel === "chat" && chatTab === "team",
  });

  const askAssistant = useCallback(
    (text: string) => {
      if (!bootstrap.ai) return;
      setAiSeed((s) => ({ key: s.key + 1, text }));
      setChatTab("ai");
      setPanel("chat");
    },
    [bootstrap.ai],
  );

  const onChange = useCallback(
    (
      elements: readonly OrderedExcalidrawElement[],
      appState: { selectedElementIds: Readonly<Record<string, true>> },
      files: BinaryFiles,
    ) => {
      handleChange(elements);
      if (canEdit) uploadNewFiles(files);
      const selected = Object.keys(appState.selectedElementIds).length === 1;
      setHasSelection((prev) => (prev === selected ? prev : selected));
    },
    [handleChange, canEdit, uploadNewFiles],
  );

  // A template chosen on «Νέος πίνακας» is built here, once, by the board's
  // creator when it first opens empty (0060: boards.template), then cleared.
  const applyTemplate = useCallback(
    (a: ExcalidrawImperativeAPI) => {
      const template = bootstrap.template;
      if (!template || !isBoardTemplate(template) || !canEdit) return;
      const c = viewportCenter(a);
      const skeletons = templateSkeletons(template).map((s) => ({ ...s, x: (s.x ?? 0) + c.x, y: (s.y ?? 0) + c.y }));
      if (skeletons.length > 0) {
        insertSkeletons(a, skeletons);
        a.updateScene({ appState: { selectedElementIds: {} } });
        a.scrollToContent(undefined, { fitToViewport: true, viewportZoomFactor: 0.9 });
      }
      void supabase.from("boards").update({ template: null }).eq("id", boardId);
    },
    [bootstrap.template, canEdit, supabase, boardId],
  );

  const onApi = useCallback(
    (a: ExcalidrawImperativeAPI) => {
      setApi(a);
      // Images already on the board when it opened. `api` state isn't set
      // yet inside this callback, so pass it explicitly.
      void ensureFiles(bootstrap.elements as { type: string; fileId?: string | null; updated?: number }[], a);
      if (bootstrap.template) window.setTimeout(() => applyTemplate(a), 150);
    },
    [bootstrap.elements, bootstrap.template, ensureFiles, applyTemplate],
  );

  // ---- thumbnails ----------------------------------------------------------
  // After this browser's own edits are saved, refresh the board's card
  // picture on the project page (debounced; editors only).
  const thumbTimer = useRef<number | undefined>(undefined);
  const thumbPathSet = useRef(bootstrap.hasThumbnail);
  useEffect(() => {
    if (!canEdit || !api || status !== "saved") return;
    window.clearTimeout(thumbTimer.current);
    thumbTimer.current = window.setTimeout(async () => {
      try {
        const elements = api.getSceneElements();
        if (elements.length === 0) return;
        const blob = await exportToBlob({
          elements,
          files: api.getFiles(),
          appState: { exportBackground: true, viewBackgroundColor: "#ffffff" },
          mimeType: "image/png",
          maxWidthOrHeight: 640,
          exportPadding: 24,
        });
        const path = `${orgId}/${projectId}/${boardId}/thumbnail.png`;
        const { error } = await supabase.storage
          .from("collab")
          .upload(path, blob, { upsert: true, contentType: "image/png", cacheControl: "60" });
        if (!error && !thumbPathSet.current) {
          thumbPathSet.current = true;
          await supabase.from("boards").update({ thumbnail_path: path }).eq("id", boardId);
        }
      } catch {
        // A missing thumbnail only means a plainer card.
      }
    }, THUMBNAIL_DELAY_MS);
    return () => window.clearTimeout(thumbTimer.current);
  }, [status, canEdit, api, supabase, orgId, projectId, boardId]);

  // ---- quick add -----------------------------------------------------------
  const addNote = useCallback(
    (colourIndex: number) => {
      if (!api) return;
      const c = viewportCenter(api);
      // Nudge each new note so a burst of taps doesn't stack them exactly.
      const offset = (api.getSceneElements().length % 5) * 16;
      insertSkeletons(api, [
        stickyNote(
          c.x - NOTE_SIZE / 2 + offset,
          c.y - NOTE_SIZE / 2 + offset,
          el.collab.board.stickyNote,
          NOTE_COLOURS[colourIndex] ?? NOTE_COLOURS[0],
        ),
      ]);
    },
    [api],
  );

  const toggleTools = useCallback(() => {
    setToolsExpanded((v) => {
      try {
        window.localStorage.setItem(TOOLS_KEY, v ? "0" : "1");
      } catch {
        // ignore
      }
      return !v;
    });
  }, []);

  // ---- selection actions ---------------------------------------------------
  const deleteSelection = useCallback(
    (sel: SelectionInfo) => {
      if (!api) return;
      const all = api.getSceneElementsIncludingDeleted();
      api.updateScene({
        elements: all.map((e) => (sel.ids.has(e.id) && !e.isDeleted ? newElementWith(e, { isDeleted: true }) : e)),
        appState: { selectedElementIds: {} },
        captureUpdate: CaptureUpdateAction.IMMEDIATELY,
      });
      const count = sel.elements.filter((e) => !(e.type === "text" && e.containerId && sel.ids.has(e.containerId))).length;
      push({
        message: fillText(el.collab.selection.deleted, { count }),
        action: {
          label: el.collab.confirm.undo,
          run: () => {
            const now = api.getSceneElementsIncludingDeleted();
            const selected: Record<string, true> = {};
            sel.ids.forEach((id) => (selected[id] = true));
            api.updateScene({
              elements: now.map((e) => (sel.ids.has(e.id) && e.isDeleted ? newElementWith(e, { isDeleted: false }) : e)),
              appState: { selectedElementIds: selected },
              captureUpdate: CaptureUpdateAction.IMMEDIATELY,
            });
          },
        },
      });
    },
    [api, push],
  );

  const duplicateSelection = useCallback(
    (sel: SelectionInfo) => {
      if (!api) return;
      const all = api.getSceneElementsIncludingDeleted();
      const copies = duplicateElements(all as unknown as LooseElement[], sel.ids, 24, () =>
        crypto.randomUUID().replace(/-/g, "").slice(0, 21),
      ) as unknown as ExcalidrawElement[];
      const selected: Record<string, true> = {};
      for (const c of copies) if (!(c.type === "text" && c.containerId)) selected[c.id] = true;
      api.updateScene({
        elements: [...all, ...copies],
        appState: { selectedElementIds: selected },
        captureUpdate: CaptureUpdateAction.IMMEDIATELY,
      });
    },
    [api],
  );

  const commentOnSelection = useCallback((sel: SelectionInfo) => {
    const target = sel.elements.find((e) => !(e.type === "text" && e.containerId)) ?? sel.elements[0];
    if (!target) return;
    setDraftAnchor({ element_id: target.id, scene_x: target.x + target.width, scene_y: target.y });
    setPanel("comments");
  }, []);

  const askAboutSelection = useCallback(
    (sel: SelectionInfo) => {
      const s = el.collab.selection;
      const lines = describeElements(sel.elements, {
        image: s.itemImage,
        pdf: s.itemPdf,
        shape: s.itemShape,
        arrow: s.itemArrow,
        drawing: s.itemDrawing,
      });
      askAssistant(fillText(s.askPrompt, { items: lines.map((l) => `- ${l}`).join("\n") }));
    },
    [askAssistant],
  );

  const deleteImageFile = useCallback(
    async (image: LooseElement) => {
      if (!api) return;
      const pdfFileId = typeof image.customData?.pdfFileId === "string" ? image.customData.pdfFileId : null;
      const name = typeof image.customData?.name === "string" ? image.customData.name : "";
      const ok = await confirm({ message: fillText(el.collab.fileLibrary.confirmDelete, { name: name || el.collab.selection.itemImage }) });
      if (!ok) return;
      let rowId = pdfFileId;
      if (!rowId && image.fileId) {
        const { data } = await supabase.from("board_files").select("id").eq("board_id", boardId).eq("file_id", image.fileId).maybeSingle();
        rowId = data?.id ?? null;
      }
      if (!rowId) return;
      const res = await deleteCollabFile(projectId, rowId);
      if (!res.ok) {
        notifyError(res.error);
        return;
      }
      // Every image showing this file (all pages of a PDF) reads as removed.
      const fileIds = api
        .getSceneElements()
        .filter(
          (e) =>
            e.type === "image" &&
            "fileId" in e &&
            e.fileId &&
            (e.fileId === image.fileId || (pdfFileId && (e.customData as { pdfFileId?: string } | undefined)?.pdfFileId === pdfFileId)),
        )
        .map((e) => (e as { fileId: string }).fileId);
      markRemoved(fileIds);
      notify(el.collab.fileLibrary.deleted);
    },
    [api, confirm, supabase, boardId, projectId, notify, notifyError, markRemoved],
  );

  // ---- drag & drop, paste ----------------------------------------------------
  const onDragEnter = (e: React.DragEvent) => {
    if (!canEdit || !e.dataTransfer.types.includes("Files")) return;
    e.preventDefault();
    dragDepth.current += 1;
    setDragging(true);
  };
  const onDragOver = (e: React.DragEvent) => {
    if (!canEdit || !e.dataTransfer.types.includes("Files")) return;
    // Ours, not Excalidraw's: it would refuse PDFs and skip our upload path.
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "copy";
  };
  const onDragLeave = () => {
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragging(false);
  };
  const onDrop = (e: React.DragEvent) => {
    dragDepth.current = 0;
    setDragging(false);
    if (!canEdit || !api || e.dataTransfer.files.length === 0) return;
    e.preventDefault();
    e.stopPropagation();
    const st = api.getAppState();
    const at = viewportCoordsToSceneCoords({ clientX: e.clientX, clientY: e.clientY }, st);
    uploads.addFiles(e.dataTransfer.files, at);
  };

  const addFilesRef = useRef(uploads.addFiles);
  useEffect(() => {
    addFilesRef.current = uploads.addFiles;
  }, [uploads.addFiles]);
  useEffect(() => {
    if (!canEdit) return;
    // Capture on window, before Excalidraw's own document listener, so
    // pasted PDFs and multi-file pastes take the same path as drops.
    const onPaste = (e: ClipboardEvent) => {
      if (isTypingTarget(e.target)) return;
      const files = Array.from(e.clipboardData?.files ?? []);
      if (files.length === 0) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      addFilesRef.current(files);
    };
    window.addEventListener("paste", onPaste, true);
    return () => window.removeEventListener("paste", onPaste, true);
  }, [canEdit]);

  // ---- render ------------------------------------------------------------------
  const openThreads = comments.filter((c) => !c.parent_id && !c.resolved_at).length;
  const boardTitles = useMemo(() => ({ [boardId]: bootstrap.title }), [boardId, bootstrap.title]);
  const closePanel = () => {
    setPanel(null);
    setPlacing(false);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex h-14 shrink-0 items-center gap-1.5 border-b border-line bg-surface px-2 sm:px-3">
        <Link
          href={bootstrap.backHref}
          className="flex h-11 shrink-0 items-center gap-1 rounded-lg px-2 text-sm text-ink-muted hover:bg-bg hover:text-ink"
          aria-label={el.collab.board.back}
        >
          <span aria-hidden="true" className="text-lg">
            ←
          </span>
          <span className="hidden md:inline">{el.collab.board.back}</span>
        </Link>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">{bootstrap.title}</div>
          <div className={`truncate text-[11px] ${status === "offline" || status === "error" ? "text-red-ink" : "text-ink-faint"}`}>
            {!canEdit && <span className="font-medium text-amber-ink">{el.collab.viewOnly} · </span>}
            {STATUS_LABEL[status]}
          </div>
        </div>
        {peers.length > 0 && (
          <div className="hidden items-center -space-x-1.5 sm:flex" aria-label={el.collab.presence.online}>
            {peers.slice(0, 4).map((p) => (
              <button
                key={p.userId}
                type="button"
                title={`${p.name} · ${el.collab.presence.goTo}`}
                className="flex h-9 w-9 items-center justify-center rounded-full border-2 border-surface text-xs font-semibold text-white"
                style={{ background: p.color }}
                onClick={() => {
                  if (!api || !p.pointer) return;
                  const s = api.getAppState();
                  api.updateScene({
                    appState: {
                      scrollX: s.width / 2 / s.zoom.value - p.pointer.x,
                      scrollY: s.height / 2 / s.zoom.value - p.pointer.y,
                    },
                  });
                }}
              >
                {(p.name || "?").slice(0, 1).toUpperCase()}
              </button>
            ))}
          </div>
        )}
        <button
          type="button"
          onClick={() => setPanel((p) => (p === "comments" ? null : "comments"))}
          className={`relative flex h-11 min-w-11 items-center justify-center gap-1 rounded-lg border px-2.5 text-sm font-medium ${
            panel === "comments" ? "border-sage-strong bg-sage text-sage-ink" : "border-line-strong bg-surface hover:bg-bg"
          }`}
          aria-label={el.collab.comments.title}
          title={el.collab.comments.title}
        >
          <span aria-hidden="true">📌</span>
          <span className="hidden lg:inline">{el.collab.comments.title}</span>
          {openThreads > 0 && <span className="text-xs">{openThreads}</span>}
        </button>
        <button
          type="button"
          onClick={() => {
            if (panel === "chat") setPanel(null);
            else {
              setChatTab("team");
              setPanel("chat");
            }
          }}
          className={`relative flex h-11 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold shadow-sm ${
            panel === "chat" ? "bg-ink text-white" : "bg-sage-strong text-ink hover:bg-sage"
          }`}
          title={el.collab.chat.title}
        >
          <span aria-hidden="true" className="text-base">
            💬
          </span>
          {el.collab.chat.open}
          {chat.unread > 0 && (
            <span className="absolute -top-1.5 -right-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-ink px-1 text-[11px] font-bold text-white">
              {chat.unread > 99 ? "99+" : chat.unread}
              <span className="sr-only"> {el.collab.chat.unread}</span>
            </span>
          )}
        </button>
      </header>

      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <div
          className={`collab-board relative min-h-0 flex-1 ${toolsExpanded ? "" : "collab-tools-collapsed"}`}
          onDragEnterCapture={onDragEnter}
          onDragOverCapture={onDragOver}
          onDragLeaveCapture={onDragLeave}
          onDropCapture={onDrop}
        >
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
              <MainMenu.Item onSelect={() => setHelp(true)}>{el.collab.shortcuts.open}</MainMenu.Item>
              <MainMenu.DefaultItems.Help />
              <MainMenu.Separator />
              <MainMenu.ItemLink href={bootstrap.backHref}>{el.collab.board.back}</MainMenu.ItemLink>
            </MainMenu>
          </Excalidraw>

          {api && <RemovedFilesLayer api={api} removed={removedFiles} />}

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

          {api && !placing && (
            <SelectionToolbar
              api={api}
              canEdit={canEdit}
              hasAi={!!bootstrap.ai}
              onDelete={deleteSelection}
              onDuplicate={duplicateSelection}
              onComment={commentOnSelection}
              onAsk={askAboutSelection}
              onOpenLink={(link) => window.open(link, "_blank", "noopener")}
              onDeleteFile={(img) => void deleteImageFile(img)}
            />
          )}

          {api && (
            <QuickAddBar
              canEdit={canEdit}
              toolsExpanded={toolsExpanded}
              commentActive={placing}
              onNote={addNote}
              onText={() => {
                api.setActiveTool({ type: "text" });
                notify(el.collab.quick.textHint);
              }}
              onArrow={() => {
                api.setActiveTool({ type: "arrow" });
                notify(el.collab.quick.arrowHint);
              }}
              onFile={() => fileInput.current?.click()}
              onComment={() => setPlacing((v) => !v)}
              onToggleTools={toggleTools}
            />
          )}

          {(uploads.progress || uploads.pdfOffer) && (
            <div className="pointer-events-none absolute inset-x-0 top-3 z-[8] flex justify-center px-2">
              {uploads.progress ? (
                <div className="pointer-events-auto flex max-w-full items-center gap-2 rounded-full bg-ink px-4 py-2 text-sm text-white shadow-lg">
                  <span className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-white/40 border-t-white" aria-hidden="true" />
                  <span className="shrink-0">
                    {fillText(el.collab.quick.uploading, { done: uploads.progress.done + 1, total: uploads.progress.total })}
                  </span>
                  <span className="min-w-0 truncate text-white/70">{uploads.progress.label}</span>
                </div>
              ) : (
                uploads.pdfOffer && (
                  <div className="pointer-events-auto flex max-w-full flex-wrap items-center gap-2 rounded-2xl border border-line-strong bg-surface px-4 py-2 text-sm shadow-lg">
                    <span className="min-w-0">
                      {fillText(el.collab.quick.pdfPages, { name: uploads.pdfOffer.name, pages: uploads.pdfOffer.numPages })}
                    </span>
                    <button
                      type="button"
                      className="min-h-11 rounded-lg bg-ink px-3 font-medium text-white"
                      onClick={() => void uploads.acceptPdfOffer()}
                    >
                      {uploads.pdfOffer.numPages > 10 ? el.collab.quick.pdfAllPagesMax : el.collab.quick.pdfAllPages}
                    </button>
                    <button type="button" className="min-h-11 rounded-lg px-3 text-ink-muted hover:bg-bg" onClick={uploads.dismissPdfOffer}>
                      {el.collab.quick.pdfDismiss}
                    </button>
                  </div>
                )
              )}
            </div>
          )}

          {dragging && (
            <div className="pointer-events-none absolute inset-2 z-[9] flex items-center justify-center rounded-2xl border-4 border-dashed border-sage-strong bg-sage/30">
              <span className="rounded-xl bg-surface px-5 py-3 text-base font-semibold shadow-lg">{el.collab.quick.dropHere}</span>
            </div>
          )}

          <ToastStack toasts={toasts} onDismiss={dismiss} className="absolute inset-x-0 bottom-24 z-[10] px-2 max-md:bottom-[9.5rem]" />

          <BoardTips />
          {help && <ShortcutsHelp onClose={() => setHelp(false)} />}

          <input
            ref={fileInput}
            type="file"
            multiple
            accept={COLLAB_FILE_TYPES.join(",")}
            className="hidden"
            onChange={(e) => {
              const files = e.target.files ? Array.from(e.target.files) : [];
              e.target.value = "";
              if (files.length) uploads.addFiles(files);
            }}
          />
        </div>

        {panel && (
          <aside
            className={`flex min-h-0 flex-col border-line bg-surface max-md:fixed max-md:inset-x-0 max-md:bottom-0 max-md:z-40 max-md:h-[75dvh] max-md:rounded-t-2xl max-md:border-t max-md:shadow-2xl md:border-l ${
              panel === "chat" ? "md:w-96" : "md:w-80"
            }`}
          >
            <div className="flex items-center justify-between gap-2 border-b border-line px-2 py-1.5">
              {panel === "chat" ? (
                <div className="flex gap-1" role="tablist">
                  <TabButton active={chatTab === "team"} onClick={() => setChatTab("team")}>
                    👥 {el.collab.chat.teamTab}
                  </TabButton>
                  {bootstrap.ai && (
                    <TabButton active={chatTab === "ai"} onClick={() => setChatTab("ai")} ai>
                      <AiSpark /> {el.collab.chat.aiTab}
                    </TabButton>
                  )}
                </div>
              ) : (
                <h2 className="px-1 text-sm font-semibold">{el.collab.comments.title}</h2>
              )}
              <button
                type="button"
                className="flex h-11 w-11 items-center justify-center rounded-lg text-xl text-ink-muted hover:bg-bg"
                onClick={closePanel}
                aria-label={el.collab.comments.close}
              >
                ×
              </button>
            </div>
            {panel === "chat" && chatTab === "ai" && bootstrap.ai ? (
              <AiPanel
                key={aiSeed.key}
                supabase={supabase}
                boardId={boardId}
                api={api}
                rights={bootstrap.ai}
                onToast={notifyError}
                meId={me.userId}
                canManage={canManage}
                confirm={confirm}
                initialInput={aiSeed.text}
              />
            ) : panel === "chat" ? (
              <TeamChat
                chat={chat}
                projectId={projectId}
                boardId={boardId}
                meId={me.userId}
                people={bootstrap.people}
                canUpload={canEdit}
                canManage={canManage}
                onAskAssistant={bootstrap.ai ? askAssistant : undefined}
                onToast={notify}
                confirm={confirm}
                boardTitles={boardTitles}
              />
            ) : (
              <CommentsPanel
                comments={comments}
                people={bootstrap.people}
                meId={me.userId}
                canEdit={canEdit}
                canManage={canManage}
                confirm={confirm}
                focusedId={focusedId}
                draftAnchor={draftAnchor}
                canAnchorToSelection={hasSelection}
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
      </div>

      {dialog}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
  ai = false,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  ai?: boolean;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`flex min-h-11 items-center gap-1.5 rounded-lg px-4 text-sm font-medium ${
        active ? (ai ? "bg-ai-strong text-white" : "bg-ink text-white") : ai ? "text-ai-ink hover:bg-ai-bg" : "text-ink hover:bg-bg"
      }`}
    >
      {children}
    </button>
  );
}
