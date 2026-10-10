"use client";

import { useId, type ReactNode } from "react";
import { el } from "@/lib/i18n/el";
import { shell } from "@/lib/i18n/v2/shell";
import { cn } from "./cn";
import { DialogForm } from "./Modal";
import { useDialog } from "./useDialog";

// "Read first, edit in a drawer": a panel from the right on desktop, a full
// screen sheet below md. Native <dialog> (see useDialog): top layer, inert
// page behind, Escape closes, focus returns. Mount only while open.
export function Drawer({
  onClose,
  title,
  eyebrow,
  children,
  footer,
  width = "md",
  closeOnBackdrop = true,
}: {
  onClose: () => void;
  title: ReactNode;
  eyebrow?: ReactNode;
  children: ReactNode;
  // Sticky at the bottom (the form's buttons).
  footer?: ReactNode;
  width?: "md" | "lg";
  closeOnBackdrop?: boolean;
}) {
  const { ref, onClick, close } = useDialog(onClose, closeOnBackdrop);
  const titleId = useId();
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-modal="true"
      onClick={onClick}
      className={cn(
        "fixed inset-0 m-0 h-dvh max-h-none w-full max-w-none bg-raised p-0 text-ink",
        "md:right-0 md:left-auto md:border-l md:border-hairline",
        width === "md" ? "md:w-drawer" : "md:w-[min(56rem,100vw)]",
      )}
    >
      <div className="flex h-full flex-col">
        <header className="flex items-start justify-between gap-4 border-b border-rule px-5 pt-5 pb-4 md:px-8 md:pt-7">
          <div className="flex min-w-0 flex-col gap-1">
            {eyebrow && <p className="eyebrow text-muted">{eyebrow}</p>}
            <h2 id={titleId} className="text-section font-normal text-ink">
              {title}
            </h2>
          </div>
          <button
            type="button"
            onClick={close}
            aria-label={shell.ui.close}
            className="-mr-2 inline-flex min-h-10 min-w-10 items-center justify-center text-xl text-muted hover:bg-hover hover:text-ink"
          >
            <span aria-hidden="true">×</span>
          </button>
        </header>
        <div className="flex-1 overflow-y-auto px-5 py-5 md:px-8">{children}</div>
        {footer && <footer className="border-t border-hairline px-5 py-4 md:px-8">{footer}</footer>}
      </div>
    </dialog>
  );
}

// A Drawer around a <form action>; same error handling as FormModal. The
// buttons sit in the drawer's sticky footer.
export function FormDrawer({
  onClose,
  title,
  eyebrow,
  action,
  onSuccess,
  children,
  submitLabel = el.common.save,
  width,
}: {
  onClose: () => void;
  title: ReactNode;
  eyebrow?: ReactNode;
  action: (formData: FormData) => Promise<unknown>;
  onSuccess?: (result: unknown) => void;
  children: ReactNode;
  submitLabel?: ReactNode;
  width?: "md" | "lg";
}) {
  return (
    <Drawer onClose={onClose} title={title} eyebrow={eyebrow} width={width} closeOnBackdrop={false}>
      <DialogForm
        action={action}
        onSuccess={onSuccess}
        onClose={onClose}
        submitLabel={submitLabel}
        className="flex flex-col gap-4"
        footerClassName="sticky bottom-0 -mx-5 mt-4 flex justify-end gap-2 border-t border-hairline bg-raised px-5 py-4 md:-mx-8 md:px-8"
      >
        {children}
      </DialogForm>
    </Drawer>
  );
}
