"use client";

import { useState } from "react";
import { el } from "@/lib/i18n/el";
import { NOTE_COLOURS } from "@/lib/collab/templates";

const q = el.collab.quick;

// The big, labelled bar for adding things to a board: bottom-centre on
// desktop, bottom (above Excalidraw's own mobile bar) on phones. Every
// target is at least 44px. Guests only get «Σχόλιο».
export function QuickAddBar({
  canEdit,
  toolsExpanded,
  onNote,
  onText,
  onFile,
  onComment,
  onArrow,
  onToggleTools,
  commentActive,
}: {
  canEdit: boolean;
  toolsExpanded: boolean;
  onNote: (colourIndex: number) => void;
  onText: () => void;
  onFile: () => void;
  onComment: () => void;
  onArrow: () => void;
  onToggleTools: () => void;
  commentActive: boolean;
}) {
  const [colours, setColours] = useState(false);

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-3 z-[6] flex justify-center px-2 max-md:bottom-[4.25rem]">
      <div className="pointer-events-auto relative flex max-w-full items-stretch gap-px overflow-x-auto border border-hairline bg-raised p-1">
        {canEdit && (
          <>
            <Tool
              icon={
                <span
                  className="block h-5 w-5 border"
                  style={{ background: NOTE_COLOURS[0].bg, borderColor: NOTE_COLOURS[0].stroke }}
                  aria-hidden="true"
                />
              }
              label={q.note}
              active={colours}
              onClick={() => setColours((v) => !v)}
              ariaExpanded={colours}
            />
            <Tool icon={<span className="text-lg font-semibold leading-none">T</span>} label={q.text} onClick={onText} />
            <Tool icon={<span className="text-lg leading-none">🖼️</span>} label={q.file} onClick={onFile} />
          </>
        )}
        <Tool icon={<span className="text-lg leading-none">💬</span>} label={q.comment} onClick={onComment} active={commentActive} />
        {canEdit && (
          <>
            <Tool icon={<span className="text-lg leading-none">↗</span>} label={q.arrow} onClick={onArrow} />
            <Tool
              icon={<span className="text-lg leading-none">{toolsExpanded ? "▾" : "⋯"}</span>}
              label={toolsExpanded ? q.lessTools : q.moreTools}
              onClick={onToggleTools}
              active={toolsExpanded}
              ariaExpanded={toolsExpanded}
            />
          </>
        )}
      </div>
      {colours && canEdit && (
        <div
          role="menu"
          aria-label={q.chooseColour}
          className="pointer-events-auto absolute bottom-full mb-2 flex gap-1 border border-hairline bg-raised p-1.5"
        >
          {NOTE_COLOURS.map((c, i) => (
            <button
              key={c.bg}
              type="button"
              role="menuitem"
              title={q.colours[i]}
              aria-label={`${q.note} · ${q.colours[i]}`}
              className="flex h-12 w-12 items-center justify-center hover:bg-hover"
              onClick={() => {
                setColours(false);
                onNote(i);
              }}
            >
              <span className="block h-8 w-8 border" style={{ background: c.bg, borderColor: c.stroke }} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Tool({
  icon,
  label,
  onClick,
  active = false,
  ariaExpanded,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  active?: boolean;
  ariaExpanded?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={ariaExpanded}
      aria-pressed={ariaExpanded === undefined ? active : undefined}
      className={`flex min-h-14 min-w-14 shrink-0 flex-col items-center justify-center gap-0.5 px-2 text-xs leading-tight font-medium ${
        active ? "bg-navy text-panel-ink" : "text-ink hover:bg-hover"
      }`}
    >
      {icon}
      <span className="max-w-[4.5rem] text-center">{label}</span>
    </button>
  );
}
