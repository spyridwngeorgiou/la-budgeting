"use client";

import { useEffect, useState } from "react";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { el } from "@/lib/i18n/el";
import type { BoardComment } from "./types";

type Viewport = { scrollX: number; scrollY: number; zoom: number };

// Comment pins drawn over the canvas, in viewport coordinates derived from
// Excalidraw's scroll/zoom: viewport = (scene + scroll) * zoom. Kept as its
// own component subscribed straight to the Excalidraw API, so scrolling
// re-renders a handful of pins rather than the whole board.
//
// Element-anchored threads follow their element (re-read on every scene
// change); point-anchored ones sit where they were dropped.
export function CommentsLayer({
  api,
  comments,
  placing,
  onPlace,
  onOpenThread,
}: {
  api: ExcalidrawImperativeAPI;
  comments: BoardComment[];
  placing: boolean;
  onPlace: (scene: { x: number; y: number }) => void;
  onOpenThread: (id: string) => void;
}) {
  const [viewport, setViewport] = useState<Viewport>(() => {
    const s = api.getAppState();
    return { scrollX: s.scrollX, scrollY: s.scrollY, zoom: s.zoom.value };
  });
  const [, setSceneTick] = useState(0);
  const hasElementAnchors = comments.some((c) => c.element_id);

  useEffect(() => api.onScrollChange((scrollX, scrollY, zoom) => setViewport({ scrollX, scrollY, zoom: zoom.value })), [api]);

  useEffect(() => {
    if (!hasElementAnchors) return;
    let frame = 0;
    const unsubscribe = api.onChange(() => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        setSceneTick((t) => t + 1);
      });
    });
    return () => {
      unsubscribe();
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [api, hasElementAnchors]);

  const roots = comments.filter((c) => !c.parent_id && !c.resolved_at);
  const elements = hasElementAnchors ? api.getSceneElements() : [];
  const replyCount = (id: string) => comments.filter((c) => c.parent_id === id).length;

  const pins = roots.flatMap((c) => {
    let x = c.scene_x;
    let y = c.scene_y;
    if (c.element_id) {
      const target = elements.find((e) => e.id === c.element_id);
      if (target) {
        x = target.x + target.width;
        y = target.y;
      }
    }
    if (x === null || y === null) return [];
    return [{ c, left: (x + viewport.scrollX) * viewport.zoom, top: (y + viewport.scrollY) * viewport.zoom }];
  });

  return (
    <div className="pointer-events-none absolute inset-0 z-[5] overflow-hidden">
      {pins.map(({ c, left, top }) => (
        <button
          key={c.id}
          type="button"
          onClick={() => onOpenThread(c.id)}
          className="pointer-events-auto absolute flex h-7 min-w-7 -translate-x-1/2 -translate-y-full items-center justify-center border border-warning bg-warning-tint px-1.5 text-xs font-medium text-warning hover:bg-hover"
          style={{ left, top }}
          title={c.body.slice(0, 120)}
        >
          💬{replyCount(c.id) > 0 ? ` ${replyCount(c.id) + 1}` : ""}
        </button>
      ))}

      {placing && (
        <div
          className="pointer-events-auto absolute inset-0 cursor-crosshair bg-warning-tint/10"
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            onPlace({
              x: (e.clientX - rect.left) / viewport.zoom - viewport.scrollX,
              y: (e.clientY - rect.top) / viewport.zoom - viewport.scrollY,
            });
          }}
        >
          <div className="pointer-events-none absolute top-16 left-1/2 -translate-x-1/2 bg-panel px-3 py-1.5 text-xs text-panel-ink">
            {el.collab.comments.pinHint}
          </div>
        </div>
      )}
    </div>
  );
}
