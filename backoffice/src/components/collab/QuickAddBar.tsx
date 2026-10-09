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
      <div className="pointer-events-auto relative flex max-w-full items-stretch gap-0.5 overflow-x-auto rounded-2xl border border-line-strong bg-surface/95 p-1 shadow-lg backdrop-blur">
        {canEdit && (
          <>
            <Tool
              icon={<span className="block h-5 w-5 rounded-sm border border-[#f08c00] bg-[#ffec99]" aria-hidden="true" />}
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
          className="pointer-events-auto absolute bottom-full mb-2 flex gap-1 rounded-2xl border border-line-strong bg-surface p-1.5 shadow-lg"
        >
          {NOTE_COLOURS.map((c, i) => (
            <button
              key={c.bg}
              type="button"
              role="menuitem"
              title={q.colours[i]}
              aria-label={`${q.note} · ${q.colours[i]}`}
              className="flex h-12 w-12 items-center justify-center rounded-xl hover:bg-bg"
              onClick={() => {
                setColours(false);
                onNote(i);
              }}
            >
              <span className="block h-8 w-8 rounded-md border" style={{ background: c.bg, borderColor: c.stroke }} />
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
      className={`flex min-h-14 min-w-14 shrink-0 flex-col items-center justify-center gap-0.5 rounded-xl px-2 text-[11px] font-medium leading-tight ${
        active ? "bg-sage text-sage-ink" : "text-ink hover:bg-bg"
      }`}
    >
      {icon}
      <span className="max-w-[4.5rem] text-center">{label}</span>
    </button>
  );
}
