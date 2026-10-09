// Self-hosts Excalidraw's fonts (Excalidraw README, "Self-hosting fonts"):
// copies node_modules/@excalidraw/excalidraw/dist/prod/fonts into
// public/excalidraw-assets/fonts, which BoardCanvas points
// window.EXCALIDRAW_ASSET_PATH at. Without it every board load pulls fonts
// from a third-party CDN.
//
// Also copies pdf.js's worker (pdfjs-dist legacy build) to public/pdfjs/,
// where components/collab/pdfRender.ts loads it from when someone drops a
// PDF on a board. Served as a static file, so it is never part of the
// server / Worker bundle.
//
// Runs as predev/prebuild (so `cf:*` builds get it too) rather than being
// committed: ~14 MB of font files that change with every package bump.

import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "node_modules", "@excalidraw", "excalidraw", "dist", "prod", "fonts");
const dest = join(root, "public", "excalidraw-assets", "fonts");

if (!existsSync(src)) {
  console.error(`Excalidraw fonts not found at ${src} -- run npm install first.`);
  process.exit(1);
}

rmSync(dest, { recursive: true, force: true });
cpSync(src, dest, { recursive: true });
console.log(`Copied Excalidraw fonts -> ${dest}`);

const pdfWorker = join(root, "node_modules", "pdfjs-dist", "legacy", "build", "pdf.worker.min.mjs");
const pdfDest = join(root, "public", "pdfjs");
if (!existsSync(pdfWorker)) {
  console.error(`pdf.js worker not found at ${pdfWorker} -- run npm install first.`);
  process.exit(1);
}
rmSync(pdfDest, { recursive: true, force: true });
mkdirSync(pdfDest, { recursive: true });
cpSync(pdfWorker, join(pdfDest, "pdf.worker.min.mjs"));
// Image decoders (JPEG 2000, JBIG2 -- common in scanned drawings) and the
// standard fonts, so pdf.js never reaches for a CDN. The QuickJS scripting
// engine is left out: PDF JavaScript is never run here.
const pdfRoot = join(root, "node_modules", "pdfjs-dist");
cpSync(join(pdfRoot, "wasm"), join(pdfDest, "wasm"), {
  recursive: true,
  filter: (p) => !/quickjs/i.test(p),
});
cpSync(join(pdfRoot, "standard_fonts"), join(pdfDest, "standard_fonts"), { recursive: true });
console.log(`Copied pdf.js worker, decoders and fonts -> ${pdfDest}`);
