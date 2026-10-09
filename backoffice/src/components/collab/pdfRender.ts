"use client";

import { renderScale } from "@/lib/collab/pdfPages";

// Renders PDF pages to bitmaps in the browser so a dropped PDF shows up on
// the board as its first page (or several), with a link to the full file.
//
// pdfjs-dist is loaded lazily, only when someone actually drops a PDF, and
// only from this client module (BoardCanvas is ssr:false), so it never
// reaches the server / Worker bundle. Its worker script is served from
// /pdfjs/ (copied there by scripts/copy-excalidraw-assets.mjs), not bundled.
// The legacy build is used for older iPads/phones still in the field.

type PdfJs = typeof import("pdfjs-dist/legacy/build/pdf.mjs");

let loader: Promise<PdfJs> | null = null;
function loadPdfJs(): Promise<PdfJs> {
  loader ??= import("pdfjs-dist/legacy/build/pdf.mjs").then((m) => {
    m.GlobalWorkerOptions.workerSrc = "/pdfjs/pdf.worker.min.mjs";
    return m;
  });
  // A failed chunk load must not poison every later attempt.
  loader.catch(() => {
    loader = null;
  });
  return loader;
}

export interface RenderedPage {
  page: number;
  blob: Blob;
  width: number;
  height: number;
}

export interface OpenedPdf {
  numPages: number;
  render(page: number): Promise<RenderedPage>;
  close(): void;
}

export async function openPdf(file: Blob): Promise<OpenedPdf> {
  const pdfjs = await loadPdfJs();
  const data = new Uint8Array(await file.arrayBuffer());
  // Self-hosted decoders and fonts (copied to /pdfjs/ with the worker);
  // nothing is fetched from a CDN.
  const doc = await pdfjs.getDocument({
    data,
    wasmUrl: "/pdfjs/wasm/",
    standardFontDataUrl: "/pdfjs/standard_fonts/",
    enableXfa: false,
  }).promise;
  return {
    numPages: doc.numPages,
    async render(pageNumber: number) {
      const page = await doc.getPage(pageNumber);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: renderScale(base.width, base.height) });
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("no canvas");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvas, canvasContext: ctx, viewport }).promise;
      page.cleanup();
      const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob failed"))), "image/jpeg", 0.85),
      );
      // Free the bitmap memory right away; phones are tight on it.
      canvas.width = canvas.height = 0;
      return { page: pageNumber, blob, width: viewport.width, height: viewport.height };
    },
    close() {
      void doc.destroy();
    },
  };
}
