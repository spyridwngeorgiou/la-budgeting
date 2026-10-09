"use client";

import { useEffect, useState } from "react";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { el } from "@/lib/i18n/el";
import { AiSpark } from "@/components/ui";
import { boundsOf, expandSelection, type LooseElement } from "@/lib/collab/elements";

const s = el.collab.selection;

export interface SelectionInfo {
  ids: Set<string>;
  elements: LooseElement[];
  // The single selected image, if that is what's selected.
  image: LooseElement | null;
}

type Placement = { left: number; top: number; below: boolean } | null;

// A clear floating toolbar above whatever is selected: «Διαγραφή»,
// «Διπλότυπο», «Σχόλιο εδώ», «Ρώτα τον βοηθό» (+ file actions for an image).
// Subscribes to the Excalidraw API directly so selection and scrolling
// re-render only this toolbar. Hidden while dragging, resizing or typing.
export function SelectionToolbar({
  api,
  canEdit,
  hasAi,
  onDelete,
  onDuplicate,
  onComment,
  onAsk,
  onOpenLink,
  onDeleteFile,
}: {
  api: ExcalidrawImperativeAPI;
  canEdit: boolean;
  hasAi: boolean;
  onDelete: (sel: SelectionInfo) => void;
  onDuplicate: (sel: SelectionInfo) => void;
  onComment: (sel: SelectionInfo) => void;
  onAsk: (sel: SelectionInfo) => void;
  onOpenLink: (link: string) => void;
  onDeleteFile: (image: LooseElement) => void;
}) {
  const [state, setState] = useState<{ sel: SelectionInfo; place: Placement } | null>(null);

  useEffect(() => {
    let frame = 0;
    const compute = () => {
      frame = 0;
      const st = api.getAppState();
      const selected = Object.keys(st.selectedElementIds);
      const busy =
        selected.length === 0 ||
        st.cursorButton === "down" ||
        st.isResizing ||
        st.isRotating ||
        !!st.editingTextElement ||
        !!st.newElement ||
        st.openDialog !== null;
      if (busy) {
        setState((prev) => (prev === null ? prev : null));
        return;
      }
      const all = api.getSceneElements() as unknown as LooseElement[];
      const ids = expandSelection(all, selected);
      const elements = all.filter((e) => ids.has(e.id));
      const b = boundsOf(elements);
      if (!b) {
        setState(null);
        return;
      }
      const z = st.zoom.value;
      const left = (b.x + b.width / 2 + st.scrollX) * z;
      const topEdge = (b.y + st.scrollY) * z;
      const bottomEdge = (b.y + b.height + st.scrollY) * z;
      const below = topEdge < 70;
      const top = below ? bottomEdge + 12 : topEdge - 12;
      const roots = elements.filter((e) => !(e.type === "text" && e.containerId && ids.has(e.containerId)));
      const image = roots.length === 1 && roots[0].type === "image" ? roots[0] : null;
      setState({
        sel: { ids, elements, image },
        place: { left: Math.min(Math.max(left, 150), st.width - 150), top: Math.min(Math.max(top, 8), st.height - 60), below },
      });
    };
    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(compute);
    };
    const un1 = api.onChange(schedule);
    const un2 = api.onScrollChange(schedule);
    const un3 = api.onPointerUp(schedule);
    schedule();
    return () => {
      un1();
      un2();
      un3();
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [api, canEdit]);

  if (!state?.place) return null;
  const { sel, place } = state;
  const link = sel.image && typeof sel.image.link === "string" ? sel.image.link : null;

  return (
    <div
      className="pointer-events-auto absolute z-[7] flex items-center gap-0.5 rounded-xl border border-line-strong bg-surface p-1 shadow-lg"
      style={{ left: place.left, top: place.top, transform: `translate(-50%, ${place.below ? "0" : "-100%"})` }}
      role="toolbar"
      aria-label={el.collab.project.moreActions}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {canEdit && (
        <>
          <Btn label={s.delete} icon="🗑️" danger onClick={() => onDelete(sel)} />
          <Btn label={s.duplicate} icon="⧉" onClick={() => onDuplicate(sel)} />
        </>
      )}
      <Btn label={s.comment} icon="💬" onClick={() => onComment(sel)} />
      {hasAi && <Btn label={s.ask} icon={<AiSpark className="h-4 w-4 text-ai-ink" />} onClick={() => onAsk(sel)} />}
      {link && <Btn label={el.collab.quick.openPdf} icon="📄" onClick={() => onOpenLink(link)} />}
      {canEdit && sel.image && <Btn label={s.deleteFile} icon="✖" danger onClick={() => sel.image && onDeleteFile(sel.image)} />}
    </div>
  );
}

function Btn({
  label,
  icon,
  onClick,
  danger = false,
}: {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      className={`flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-lg px-2.5 text-xs font-medium whitespace-nowrap ${
        danger ? "text-red-ink hover:bg-red-bg" : "text-ink hover:bg-bg"
      }`}
    >
      <span aria-hidden="true" className="text-base leading-none">
        {icon}
      </span>
      <span className="max-sm:sr-only">{label}</span>
    </button>
  );
}
