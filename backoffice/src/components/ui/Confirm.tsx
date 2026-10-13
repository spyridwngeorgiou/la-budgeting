"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { el } from "@/lib/i18n/el";
import { buttonClass } from "./Button";

// The app's one «Είστε σίγουροι;» (in place of the browser's confirm box):
// a small dialog, Cancel focused, Escape or a click outside cancels.
//
//   const { confirm, dialog } = useConfirm();
//   if (!(await confirm({ message: "…; Δεν αναιρείται." }))) return;
//   … render {dialog} somewhere in the component.

export interface ConfirmRequest {
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
        <p className="mt-2 text-body text-text">{message}</p>
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
