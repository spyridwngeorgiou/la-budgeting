"use client";

import dynamic from "next/dynamic";
import { el } from "@/lib/i18n/el";
import type { BoardBootstrap } from "./types";

// Excalidraw touches window/canvas at import time and is ~1 MB of JS, so it
// is loaded only in the browser and only on board pages. Next 16 allows
// `ssr: false` solely inside a Client Component -- hence this wrapper
// between the server page and BoardCanvas.
//
// Fonts are self-hosted (scripts/copy-excalidraw-assets.mjs -> public/
// excalidraw-assets/). Set here, at module scope, because this module is
// evaluated before the lazy BoardCanvas chunk that imports Excalidraw.
if (typeof window !== "undefined") {
  (window as unknown as { EXCALIDRAW_ASSET_PATH?: string }).EXCALIDRAW_ASSET_PATH = "/excalidraw-assets/";
}

const BoardCanvas = dynamic(() => import("./BoardCanvas"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center text-sm text-muted">{el.collab.board.loading}</div>
  ),
});

export function BoardLoader({ bootstrap }: { bootstrap: BoardBootstrap }) {
  return <BoardCanvas bootstrap={bootstrap} />;
}
