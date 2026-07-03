"use client";

import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/** Presentational modal shell, controlled via `open`/`onClose`. */
export function ModalShell({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        className={cn(
          "flex max-h-[92vh] w-full max-w-lg flex-col rounded-t-2xl border border-border bg-card shadow-xl sm:max-h-[88vh] sm:rounded-xl",
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h3 className="font-semibold text-foreground">{title}</h3>
          <button
            onClick={onClose}
            className="-mr-1 rounded-lg p-1 text-muted hover:bg-slate-100 hover:text-foreground"
            aria-label="Κλείσιμο"
          >
            <X size={22} />
          </button>
        </div>
        <div className="overflow-y-auto p-5">{children}</div>
      </div>
    </div>
  );
}
