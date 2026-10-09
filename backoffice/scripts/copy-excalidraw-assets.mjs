// Self-hosts Excalidraw's fonts (Excalidraw README, "Self-hosting fonts"):
// copies node_modules/@excalidraw/excalidraw/dist/prod/fonts into
// public/excalidraw-assets/fonts, which BoardCanvas points
// window.EXCALIDRAW_ASSET_PATH at. Without it every board load pulls fonts
// from a third-party CDN.
//
// Runs as predev/prebuild (so `cf:*` builds get it too) rather than being
// committed: ~14 MB of font files that change with every package bump.

import { cpSync, existsSync, rmSync } from "node:fs";
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
