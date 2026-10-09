"use client";

import { CaptureUpdateAction, convertToExcalidrawElements } from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { ExcalidrawElementSkeleton } from "@excalidraw/excalidraw/data/transform";
import { el } from "@/lib/i18n/el";

// Scene coordinates of the visible canvas's centre:
// scene = viewport / zoom - scroll.
export function viewportCenter(api: ExcalidrawImperativeAPI) {
  const s = api.getAppState();
  return { x: s.width / 2 / s.zoom.value - s.scrollX, y: s.height / 2 / s.zoom.value - s.scrollY };
}

// Inserts skeleton elements at the end of the scene as one undoable step and
// selects the first. Goes through the normal onChange -> sync path, so the
// new elements are broadcast and saved like any hand-drawn shape. (Also the
// seam Stage 2b's AI proposals will use to place generated elements.)
export function insertSkeletons(api: ExcalidrawImperativeAPI, skeletons: ExcalidrawElementSkeleton[]) {
  const created = convertToExcalidrawElements(skeletons, { regenerateIds: true });
  if (created.length === 0) return;
  api.updateScene({
    elements: [...api.getSceneElementsIncludingDeleted(), ...created],
    appState: { selectedElementIds: { [created[0].id]: true } },
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });
}

const NOTE_SIZE = 200;

// Excalidraw has no sticky-note tool; a filled, rough-free rectangle with a
// bound label is what its own libraries use for one.
export function StickyNoteButton({ api }: { api: ExcalidrawImperativeAPI }) {
  return (
    <button
      type="button"
      className="flex h-9 items-center gap-1 rounded-lg border border-[#f08c00]/50 bg-[#fff3bf] px-2.5 text-xs font-medium text-[#8a5a00] shadow-sm hover:bg-[#ffec99]"
      onClick={() => {
        const c = viewportCenter(api);
        // Nudge each new note so a burst of clicks doesn't stack them exactly.
        const offset = (api.getSceneElements().length % 5) * 16;
        insertSkeletons(api, [
          {
            type: "rectangle",
            x: c.x - NOTE_SIZE / 2 + offset,
            y: c.y - NOTE_SIZE / 2 + offset,
            width: NOTE_SIZE,
            height: NOTE_SIZE,
            backgroundColor: "#ffec99",
            fillStyle: "solid",
            strokeColor: "#f08c00",
            strokeWidth: 1,
            roughness: 0,
            label: { text: el.collab.board.stickyNote, fontSize: 20, textAlign: "left", verticalAlign: "top" },
          },
        ]);
      }}
      title={el.collab.board.stickyNote}
    >
      <span aria-hidden="true">▢</span>
      <span className="hidden sm:inline">{el.collab.board.stickyNote}</span>
    </button>
  );
}
