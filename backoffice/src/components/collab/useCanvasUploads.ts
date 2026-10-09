"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { BinaryFileData, DataURL, ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { FileId } from "@excalidraw/excalidraw/element/types";
import type { ExcalidrawElementSkeleton } from "@excalidraw/excalidraw/data/transform";
import type { Database } from "@/lib/db/types";
import { el } from "@/lib/i18n/el";
import { fillText, stripExtension } from "@/lib/collab/text";
import { layoutRow, placedSize, planPdfPages } from "@/lib/collab/pdfPages";
import { fileToDataUrl, imageSize, isAllowedCollabFile, isImageType, uploadBoardFile, type BoardScope } from "./boardFiles";
import { insertSkeletons } from "./StickyNoteButton";
import type { OpenedPdf } from "./pdfRender";

// Everything that puts files on the canvas -- the quick-add button
// (multi-select), drag-and-drop anywhere, and paste -- goes through here:
// one at a time with a visible "Ανέβασμα 2/5" indicator, images downscaled
// if huge, PDFs rendered to a first-page thumbnail linked to the full file,
// with an offer to add the other pages (up to 10).

const IMAGE_MAX_PX = 2400;
const IMAGE_PLACE_MAX = 600;
const GAP = 40;

export interface PdfOffer {
  name: string;
  numPages: number;
  extra: number;
  pdfRowId: string;
  // Where the next page goes: right of the first one.
  next: { x: number; y: number };
}

type Client = SupabaseClient<Database>;

async function prepareImage(file: File): Promise<{ blob: Blob; mimeType: string; dataURL: string; w: number; h: number }> {
  const original = await fileToDataUrl(file);
  const size = await imageSize(original);
  if (Math.max(size.w, size.h) <= IMAGE_MAX_PX && file.size <= 4 * 1024 * 1024) {
    return { blob: file, mimeType: file.type, dataURL: original, ...size };
  }
  // Phone photos: 4000px, 8 MB. Downscale once here rather than storing and
  // re-downloading the full thing on every board load.
  const k = Math.min(1, IMAGE_MAX_PX / Math.max(size.w, size.h));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(size.w * k);
  canvas.height = Math.round(size.h * k);
  const ctx = canvas.getContext("2d");
  const img = new Image();
  img.src = original;
  await img.decode().catch(() => undefined);
  if (!ctx) return { blob: file, mimeType: file.type, dataURL: original, ...size };
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const mimeType = file.type === "image/png" ? "image/png" : "image/jpeg";
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, mimeType, 0.88));
  if (!blob) return { blob: file, mimeType: file.type, dataURL: original, ...size };
  return { blob, mimeType, dataURL: await fileToDataUrl(blob), w: canvas.width, h: canvas.height };
}

export function useCanvasUploads({
  api,
  supabase,
  scope,
  projectId,
  handledFiles,
  onError,
}: {
  api: ExcalidrawImperativeAPI | null;
  supabase: Client;
  scope: BoardScope;
  projectId: string;
  handledFiles: Set<string>;
  onError: (message: string) => void;
}) {
  const [progress, setProgress] = useState<{ done: number; total: number; label: string } | null>(null);
  const [pdfOffer, setPdfOffer] = useState<PdfOffer | null>(null);
  const pdfRef = useRef<OpenedPdf | null>(null);
  const busyRef = useRef(false);
  const queueRef = useRef<{ files: File[]; at: { x: number; y: number } | null }[]>([]);

  useEffect(() => () => pdfRef.current?.close(), []);

  // Uploads one bitmap and places it as an image element at `rect`.
  const placeImage = useCallback(
    async (
      a: ExcalidrawImperativeAPI,
      img: { blob: Blob; mimeType: string; dataURL: string },
      rect: { x: number; y: number; width: number; height: number },
      meta: { name: string; derivedFrom?: string; link?: string; customData?: Record<string, unknown> },
    ) => {
      const fileId = crypto.randomUUID();
      handledFiles.add(fileId);
      await uploadBoardFile(supabase, scope, {
        fileId,
        blob: img.blob,
        mimeType: img.mimeType,
        name: meta.name,
        derivedFrom: meta.derivedFrom ?? null,
      });
      a.addFiles([
        {
          id: fileId as FileId,
          dataURL: img.dataURL as DataURL,
          mimeType: img.mimeType as BinaryFileData["mimeType"],
          created: Date.now(),
        },
      ]);
      const skeleton = {
        type: "image",
        fileId: fileId as FileId,
        status: "saved",
        ...rect,
        ...(meta.link ? { link: meta.link } : {}),
        ...(meta.customData ? { customData: meta.customData } : {}),
      } as ExcalidrawElementSkeleton;
      insertSkeletons(a, [skeleton]);
    },
    [supabase, scope, handledFiles],
  );

  const addOne = useCallback(
    async (a: ExcalidrawImperativeAPI, file: File, at: { x: number; y: number }): Promise<number> => {
      if (isImageType(file.type)) {
        const img = await prepareImage(file);
        const size = placedSize(img.w, img.h, IMAGE_PLACE_MAX);
        await placeImage(a, img, { ...at, ...size }, { name: file.name });
        return size.width;
      }

      // PDF: the file itself, then its first page as a picture linked to it.
      const pdfRowId = await uploadBoardFile(supabase, scope, {
        fileId: crypto.randomUUID(),
        blob: file,
        mimeType: "application/pdf",
        name: file.name,
      });
      const link = `/collab/${projectId}/files/${pdfRowId}`;
      try {
        setProgress((p) => (p ? { ...p, label: el.collab.quick.preparingPdf } : p));
        const { openPdf } = await import("./pdfRender");
        // A newer PDF replaces any pending «Όλες οι σελίδες» offer.
        setPdfOffer(null);
        pdfRef.current?.close();
        const pdf = await openPdf(file);
        pdfRef.current = pdf;
        const page = await pdf.render(1);
        const size = placedSize(page.width, page.height);
        const dataURL = await fileToDataUrl(page.blob);
        await placeImage(a, { blob: page.blob, mimeType: "image/jpeg", dataURL }, { ...at, ...size }, {
          link,
          name: `${stripExtension(file.name)} · ${fillText(el.collab.quick.pdfPageLabel, { page: 1 })}`,
          derivedFrom: pdfRowId,
          customData: { pdfFileId: pdfRowId, page: 1, name: file.name },
        });
        const extra = planPdfPages(pdf.numPages, "rest").length;
        if (extra > 0) {
          setPdfOffer({ name: file.name, numPages: pdf.numPages, extra, pdfRowId, next: { x: at.x + size.width + GAP, y: at.y } });
        } else {
          pdf.close();
          pdfRef.current = null;
        }
        return size.width;
      } catch {
        // No preview (pdf.js failed to load, or an odd PDF): a linked card.
        onError(el.collab.quick.pdfFailed);
        insertSkeletons(a, [
          {
            type: "rectangle",
            x: at.x,
            y: at.y,
            width: 280,
            height: 80,
            backgroundColor: "#e7f5ff",
            fillStyle: "solid",
            strokeColor: "#1971c2",
            strokeWidth: 1,
            roughness: 0,
            link,
            customData: { pdfFileId: pdfRowId, name: file.name },
            label: { text: `PDF · ${file.name}`.slice(0, 80), fontSize: 16 },
          },
        ]);
        return 280;
      }
    },
    [supabase, scope, projectId, placeImage, onError],
  );

  const run = useCallback(async () => {
    if (busyRef.current || !api) return;
    busyRef.current = true;
    try {
      while (queueRef.current.length > 0) {
        const job = queueRef.current.shift();
        if (!job) break;
        const s = api.getAppState();
        const centre = { x: s.width / 2 / s.zoom.value - s.scrollX, y: s.height / 2 / s.zoom.value - s.scrollY };
        const origin = job.at ?? { x: centre.x - 200, y: centre.y - 150 };
        let x = origin.x;
        for (let i = 0; i < job.files.length; i++) {
          setProgress({ done: i, total: job.files.length, label: job.files[i].name });
          try {
            x += (await addOne(api, job.files[i], { x, y: origin.y })) + GAP;
          } catch (e) {
            onError(e instanceof Error && e.message === "unsupported" ? el.collab.board.unsupportedFile : el.collab.board.uploadFailed);
          }
        }
      }
    } finally {
      busyRef.current = false;
      setProgress(null);
    }
  }, [api, addOne, onError]);

  // Accepts any mix; drops what the bucket wouldn't take (with one message).
  const addFiles = useCallback(
    (list: FileList | File[], at: { x: number; y: number } | null = null) => {
      const files = Array.from(list);
      const ok = files.filter((f) => isAllowedCollabFile(f.type, f.size));
      if (ok.length < files.length) onError(el.collab.board.unsupportedFile);
      if (ok.length === 0) return;
      queueRef.current.push({ files: ok, at });
      void run();
    },
    [run, onError],
  );

  const acceptPdfOffer = useCallback(async () => {
    const offer = pdfOffer;
    const pdf = pdfRef.current;
    setPdfOffer(null);
    if (!offer || !pdf || !api) return;
    const pages = planPdfPages(pdf.numPages, "rest");
    busyRef.current = true;
    try {
      const rendered: { blob: Blob; w: number; h: number; page: number }[] = [];
      for (let i = 0; i < pages.length; i++) {
        setProgress({ done: i, total: pages.length, label: el.collab.quick.preparingPdf });
        const r = await pdf.render(pages[i]);
        const size = placedSize(r.width, r.height);
        rendered.push({ blob: r.blob, w: size.width, h: size.height, page: pages[i] });
      }
      const positions = layoutRow(
        rendered.map((r) => ({ width: r.w, height: r.h })),
        offer.next,
        GAP,
        5,
      );
      const link = `/collab/${projectId}/files/${offer.pdfRowId}`;
      for (let i = 0; i < rendered.length; i++) {
        setProgress({ done: i, total: rendered.length, label: offer.name });
        const r = rendered[i];
        const dataURL = await fileToDataUrl(r.blob);
        await placeImage(api, { blob: r.blob, mimeType: "image/jpeg", dataURL }, { ...positions[i], width: r.w, height: r.h }, {
          link,
          name: `${stripExtension(offer.name)} · ${fillText(el.collab.quick.pdfPageLabel, { page: r.page })}`,
          derivedFrom: offer.pdfRowId,
          customData: { pdfFileId: offer.pdfRowId, page: r.page, name: offer.name },
        });
      }
    } catch {
      onError(el.collab.board.uploadFailed);
    } finally {
      pdf.close();
      pdfRef.current = null;
      busyRef.current = false;
      setProgress(null);
      if (queueRef.current.length > 0) void run();
    }
  }, [pdfOffer, api, projectId, placeImage, onError, run]);

  const dismissPdfOffer = useCallback(() => {
    setPdfOffer(null);
    pdfRef.current?.close();
    pdfRef.current = null;
  }, []);

  return { addFiles, progress, pdfOffer, acceptPdfOffer, dismissPdfOffer };
}
