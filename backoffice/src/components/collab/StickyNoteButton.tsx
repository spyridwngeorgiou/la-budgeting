"use client";

import { CaptureUpdateAction, convertToExcalidrawElements } from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { ExcalidrawElementSkeleton } from "@excalidraw/excalidraw/data/transform";

// Canvas placement helpers shared by the quick-add bar, uploads, templates
// and the board assistant. (The sticky-note button itself now lives in
// QuickAddBar; notes are built by lib/collab/templates.ts stickyNote().)

// Scene coordinates of the visible canvas's centre:
// scene = viewport / zoom - scroll.
export function viewportCenter(api: ExcalidrawImperativeAPI) {
  const s = api.getAppState();
  return { x: s.width / 2 / s.zoom.value - s.scrollX, y: s.height / 2 / s.zoom.value - s.scrollY };
}

// Inserts skeleton elements at the end of the scene as one undoable step and
// selects the first. Goes through the normal onChange -> sync path, so the
// new elements are broadcast and saved like any hand-drawn shape.
export function insertSkeletons(api: ExcalidrawImperativeAPI, skeletons: ExcalidrawElementSkeleton[]) {
  const created = convertToExcalidrawElements(skeletons, { regenerateIds: true });
  if (created.length === 0) return;
  api.updateScene({
    elements: [...api.getSceneElementsIncludingDeleted(), ...created],
    appState: { selectedElementIds: { [created[0].id]: true } },
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });
}
