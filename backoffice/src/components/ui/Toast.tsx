"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { shell } from "@/lib/i18n/v2/shell";
import { cn } from "./cn";

// Short confirmations after an action («Αποθηκεύτηκε», «Αναιρέθηκε»): a
// navy strip at the bottom (above the phone bottom bar), one at a time
// visible plus a queue, gone after a few seconds. An optional action (the
// «Αναίρεση» of an approval). No library.

export interface ToastOptions {
  tone?: "default" | "negative";
  action?: { label: string; onClick: () => void };
  // ms; errors stay until dismissed when 0.
  duration?: number;
}

interface ToastItem extends ToastOptions {
  id: number;
  message: ReactNode;
}

type Show = (message: ReactNode, options?: ToastOptions) => void;

const ToastContext = createContext<Show | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => setItems((all) => all.filter((t) => t.id !== id)), []);
  const show = useCallback<Show>((message, options = {}) => {
    const id = nextId.current++;
    setItems((all) => [...all.slice(-2), { id, message, ...options }]);
  }, []);

  const current = items[items.length - 1];
  return (
    <ToastContext.Provider value={show}>
      {children}
      <div
        aria-live="polite"
        role="status"
        className="pointer-events-none fixed inset-x-0 bottom-[calc(var(--spacing-bottombar)+0.75rem)] z-50 flex justify-center px-4 md:bottom-6"
      >
        {current && <ToastView key={current.id} item={current} onDismiss={() => dismiss(current.id)} />}
      </div>
    </ToastContext.Provider>
  );
}

function ToastView({ item, onDismiss }: { item: ToastItem; onDismiss: () => void }) {
  const duration = item.duration ?? (item.tone === "negative" ? 0 : 5000);
  // The timer starts once per toast, not on every parent re-render.
  const dismissRef = useRef(onDismiss);
  useEffect(() => {
    dismissRef.current = onDismiss;
  });
  useEffect(() => {
    if (!duration) return;
    const t = setTimeout(() => dismissRef.current(), duration);
    return () => clearTimeout(t);
  }, [duration]);

  return (
    <div
      className={cn(
        "pointer-events-auto flex max-w-xl min-w-0 items-center gap-4 bg-panel py-2 pr-2 pl-4 text-sm text-panel-ink",
        item.tone === "negative" && "border-l-2 border-negative-tint",
      )}
    >
      <span className="min-w-0 flex-1">{item.message}</span>
      {item.action && (
        <button
          type="button"
          onClick={() => {
            item.action?.onClick();
            onDismiss();
          }}
          className="min-h-9 px-2 font-medium underline underline-offset-4 hover:text-panel-muted"
        >
          {item.action.label}
        </button>
      )}
      <button
        type="button"
        onClick={onDismiss}
        aria-label={shell.ui.close}
        className="inline-flex min-h-9 min-w-9 items-center justify-center text-panel-muted hover:text-panel-ink"
      >
        <span aria-hidden="true">×</span>
      </button>
    </div>
  );
}

// Outside a provider (a legacy v1 page) the toast is dropped rather than
// crashing the page.
const NOOP: Show = () => {};

export function useToast(): { show: Show } {
  const show = useContext(ToastContext);
  return useMemo(() => ({ show: show ?? NOOP }), [show]);
}
