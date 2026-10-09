"use client";

import { useEffect, useState } from "react";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { el } from "@/lib/i18n/el";

// Small overlays drawn over the canvas.

// «Το αρχείο αφαιρέθηκε» over image elements whose file was deleted (0060),
// so a removed file reads as removed rather than as a broken board. In
// viewport coordinates: viewport = (scene + scroll) * zoom.
export function RemovedFilesLayer({ api, removed }: { api: ExcalidrawImperativeAPI; removed: ReadonlySet<string> }) {
  const [, setTick] = useState(0);
  const any = removed.size > 0;

  useEffect(() => {
    if (!any) return;
    let frame = 0;
    const bump = () => {
      if (!frame)
        frame = window.requestAnimationFrame(() => {
          frame = 0;
          setTick((t) => t + 1);
        });
    };
    const un1 = api.onChange(bump);
    const un2 = api.onScrollChange(bump);
    return () => {
      un1();
      un2();
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [api, any]);

  if (!any) return null;
  const st = api.getAppState();
  const z = st.zoom.value;
  const boxes = api
    .getSceneElements()
    .filter((e) => e.type === "image" && "fileId" in e && e.fileId && removed.has(e.fileId));

  return (
    <div className="pointer-events-none absolute inset-0 z-[4] overflow-hidden">
      {boxes.map((e) => (
        <div
          key={e.id}
          className="absolute flex items-center justify-center rounded border border-dashed border-line-strong bg-bg/90 p-2 text-center text-xs text-ink-muted"
          style={{
            left: (e.x + st.scrollX) * z,
            top: (e.y + st.scrollY) * z,
            width: Math.max(40, e.width * z),
            height: Math.max(24, e.height * z),
          }}
        >
          <span>🗑️ {el.collab.fileLibrary.removed}</span>
        </div>
      ))}
    </div>
  );
}

const TIPS_KEY = "collab:tips:v1";

function tipsSeen(): boolean {
  try {
    return window.localStorage.getItem(TIPS_KEY) === "1";
  } catch {
    return true; // storage blocked: don't nag on every visit
  }
}

// Three dismissible tips the first time someone opens a board.
export function BoardTips() {
  const [step, setStep] = useState<number | null>(() => (tipsSeen() ? null : 0));
  if (step === null) return null;
  const steps = el.collab.onboarding.steps;
  const t = steps[step];
  const finish = () => {
    try {
      window.localStorage.setItem(TIPS_KEY, "1");
    } catch {
      // ignore
    }
    setStep(null);
  };

  return (
    <div className="absolute inset-0 z-[30] flex items-end justify-center bg-ink/20 p-3 sm:items-center" role="dialog" aria-modal="true" aria-label={t.title}>
      <div className="w-full max-w-sm rounded-2xl bg-surface p-5 shadow-2xl">
        <div className="mb-3 flex gap-1.5" aria-hidden="true">
          {steps.map((_, i) => (
            <span key={i} className={`h-1.5 flex-1 rounded-full ${i <= step ? "bg-sage-strong" : "bg-line"}`} />
          ))}
        </div>
        <h2 className="text-lg font-semibold">{t.title}</h2>
        <p className="mt-2 text-sm text-ink-muted">{t.body}</p>
        <div className="mt-5 flex items-center justify-between gap-2">
          <button type="button" className="min-h-11 px-2 text-sm text-ink-muted hover:text-ink" onClick={finish}>
            {el.collab.onboarding.skip}
          </button>
          <button
            type="button"
            className="min-h-11 rounded-lg bg-ink px-5 text-sm font-medium text-white hover:bg-ink/85"
            onClick={() => (step + 1 < steps.length ? setStep(step + 1) : finish())}
          >
            {step + 1 < steps.length ? el.collab.onboarding.next : el.collab.onboarding.done}
          </button>
        </div>
      </div>
    </div>
  );
}

export function ShortcutsHelp({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="absolute inset-0 z-[30] flex items-center justify-center bg-ink/20 p-3" onClick={onClose} role="presentation">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={el.collab.shortcuts.title}
        className="w-full max-w-sm rounded-2xl bg-surface p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold">{el.collab.shortcuts.title}</h2>
        <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
          {el.collab.shortcuts.list.map(([k, v]) => (
            <div key={k} className="contents">
              <dt>
                <kbd className="rounded border border-line-strong bg-bg px-1.5 py-0.5 font-mono text-xs">{k}</kbd>
              </dt>
              <dd className="text-ink-muted">{v}</dd>
            </div>
          ))}
        </dl>
        <button type="button" className="mt-4 min-h-11 w-full rounded-lg border border-line-strong text-sm hover:bg-bg" onClick={onClose}>
          {el.collab.comments.close}
        </button>
      </div>
    </div>
  );
}
