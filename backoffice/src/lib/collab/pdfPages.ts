// Planning for PDFs dropped on a board: which pages to render, at what scale,
// and where to put them. Rendering itself (pdfjs-dist, lazily loaded in the
// browser) lives in components/collab/pdfRender.ts.

export const PDF_MAX_PAGES = 10;
// Longest side of a rendered page bitmap, in pixels. Sharp enough to read a
// floor plan's labels when zoomed in, small enough to stay well under the
// bucket's 25 MB limit as JPEG.
export const PDF_RENDER_MAX_PX = 2000;
// Longest side of a page as placed on the board, in scene units.
export const PDF_PLACE_MAX = 560;

// Page numbers (1-based) to render. "first" is the default on drop; "rest"
// is what «Όλες οι σελίδες» adds afterwards (the first page is already there).
export function planPdfPages(numPages: number, mode: "first" | "all" | "rest", max = PDF_MAX_PAGES): number[] {
  const n = Math.max(0, Math.floor(numPages));
  if (n === 0) return [];
  const last = Math.min(n, Math.max(1, max));
  const all = Array.from({ length: last }, (_, i) => i + 1);
  if (mode === "first") return [1];
  if (mode === "rest") return all.slice(1);
  return all;
}

// pdf.js scale for a page whose natural size (at scale 1, in PDF points) is
// width x height, so its longest side becomes at most maxPx -- and never
// upscaled past 3x (tiny pages would otherwise produce huge blurry bitmaps).
export function renderScale(width: number, height: number, maxPx = PDF_RENDER_MAX_PX): number {
  const longest = Math.max(width, height);
  if (!(longest > 0)) return 1;
  return Math.min(3, maxPx / longest);
}

// Size on the board for a bitmap of w x h pixels.
export function placedSize(w: number, h: number, max = PDF_PLACE_MAX): { width: number; height: number } {
  const longest = Math.max(w, h);
  if (!(longest > 0)) return { width: max, height: max };
  const k = Math.min(1, max / longest);
  return { width: Math.round(w * k), height: Math.round(h * k) };
}

// Lays out items left to right from `origin` (their top-left), wrapping after
// `perRow`, with `gap` between them. Row height is the tallest item in it.
export function layoutRow(
  sizes: { width: number; height: number }[],
  origin: { x: number; y: number },
  gap = 40,
  perRow = 5,
): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  let x = origin.x;
  let y = origin.y;
  let rowHeight = 0;
  sizes.forEach((s, i) => {
    if (i > 0 && i % perRow === 0) {
      x = origin.x;
      y += rowHeight + gap;
      rowHeight = 0;
    }
    out.push({ x, y });
    x += s.width + gap;
    rowHeight = Math.max(rowHeight, s.height);
  });
  return out;
}
