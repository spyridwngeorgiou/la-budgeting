"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { el } from "@/lib/i18n/el";
import { buttonClass, cn } from "@/components/ui";

// Light-weight confirmations and toasts for the collaboration space. Every
// destructive action either asks first (useConfirm) or offers an undo
// (useToasts with an action) -- never a silent loss.

interface ConfirmRequest {
  message: string;
  confirmLabel?: string;
  tone?: "danger" | "neutral";
}

export function useConfirm() {
  const [request, setRequest] = useState<(ConfirmRequest & { resolve: (ok: boolean) => void }) | null>(null);

  const confirm = useCallback(
    (req: ConfirmRequest) => new Promise<boolean>((resolve) => setRequest({ ...req, resolve })),
    [],
  );

  const close = (ok: boolean) => {
    request?.resolve(ok);
    setRequest(null);
  };

  const dialog = request ? (
    <ConfirmDialog
      message={request.message}
      confirmLabel={request.confirmLabel ?? el.collab.confirm.yes}
      tone={request.tone ?? "danger"}
      onClose={close}
    />
  ) : null;

  return { confirm, dialog };
}

function ConfirmDialog({
  message,
  confirmLabel,
  tone,
  onClose,
}: {
  message: string;
  confirmLabel: string;
  tone: "danger" | "neutral";
  onClose: (ok: boolean) => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-ink/30 p-3 sm:items-center"
      role="presentation"
      onClick={() => onClose(false)}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-label={el.collab.confirm.title}
        className="w-full max-w-sm border border-hairline bg-raised p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-section text-ink">{el.collab.confirm.title}</h2>
        <p className="mt-2 text-sm text-text">{message}</p>
        <div className="mt-4 flex justify-end gap-2">
          <button
            ref={cancelRef}
            type="button"
            className={buttonClass("secondary", "md", "min-h-11")}
            onClick={() => onClose(false)}
          >
            {el.collab.confirm.no}
          </button>
          <button
            type="button"
            className={buttonClass(tone === "danger" ? "danger" : "primary", "md", "min-h-11")}
            onClick={() => onClose(true)}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export interface Toast {
  id: number;
  message: string;
  tone?: "neutral" | "error";
  action?: { label: string; run: () => void };
}

let nextToastId = 1;

export function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef(new Map<number, number>());

  const dismiss = useCallback((id: number) => {
    setToasts((list) => list.filter((t) => t.id !== id));
    window.clearTimeout(timers.current.get(id));
    timers.current.delete(id);
  }, []);

  const push = useCallback(
    (toast: Omit<Toast, "id">, ms = toast.action ? 8000 : 4000) => {
      const id = nextToastId++;
      setToasts((list) => [...list.slice(-2), { ...toast, id }]);
      timers.current.set(id, window.setTimeout(() => dismiss(id), ms));
      return id;
    },
    [dismiss],
  );

  useEffect(() => {
    const t = timers.current;
    return () => t.forEach((h) => window.clearTimeout(h));
  }, []);

  return { toasts, push, dismiss };
}

export function ToastStack({
  toasts,
  onDismiss,
  className = "",
}: {
  toasts: Toast[];
  onDismiss: (id: number) => void;
  className?: string;
}) {
  if (toasts.length === 0) return null;
  return (
    <div className={`pointer-events-none flex flex-col items-center gap-2 ${className}`} aria-live="polite">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={cn(
            "pointer-events-auto flex max-w-[calc(100vw-1.5rem)] items-center gap-3 bg-panel py-1 pr-1 pl-4 text-sm text-panel-ink",
            t.tone === "error" && "border-l-2 border-negative-tint",
          )}
        >
          <span className="min-w-0">{t.message}</span>
          {t.action && (
            <button
              type="button"
              className="min-h-11 shrink-0 px-3 font-medium underline underline-offset-4 hover:text-panel-muted"
              onClick={() => {
                t.action?.run();
                onDismiss(t.id);
              }}
            >
              {t.action.label}
            </button>
          )}
          <button
            type="button"
            aria-label={el.collab.comments.close}
            className="flex min-h-11 min-w-11 shrink-0 items-center justify-center text-panel-muted hover:text-panel-ink"
            onClick={() => onDismiss(t.id)}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
