"use client";

import { useId, useState, type ReactNode } from "react";
import { el } from "@/lib/i18n/el";
import { errorOf } from "@/lib/actions";
import { Button } from "./Button";
import { SubmitButton } from "../SubmitButton";
import { useDialog } from "./useDialog";

// A centred dialog for short confirmations. Anything with a form longer
// than a couple of fields belongs in a Drawer (the plan: "read first, edit
// in a drawer"); Modal stays for the legacy pages until Phase 7.

const PANEL = "w-[calc(100%-2rem)] max-w-md border border-hairline bg-raised p-6";

export function Modal({
  onClose,
  title,
  children,
  className = PANEL,
  closeOnBackdrop = true,
}: {
  onClose: () => void;
  // Rendered as the dialog's <h2> and used as its accessible name.
  title?: ReactNode;
  children: ReactNode;
  className?: string;
  closeOnBackdrop?: boolean;
}) {
  const { ref, onClick } = useDialog(onClose, closeOnBackdrop);
  const titleId = useId();
  return (
    <dialog
      ref={ref}
      aria-labelledby={title ? titleId : undefined}
      aria-modal="true"
      className={`m-auto text-ink ${className}`}
      onClick={onClick}
    >
      {title && (
        <h2 id={titleId} className="mb-4 border-b border-rule pb-3 text-section font-normal text-ink">
          {title}
        </h2>
      )}
      {children}
    </dialog>
  );
}

// The submit/error/cancel plumbing shared by FormModal and FormDrawer. The
// action may throw or return { error } (see src/lib/actions.ts); either way
// the message is shown above the buttons and the dialog stays open.
// Anything else closes it.
export function DialogForm({
  action,
  onSuccess,
  onClose,
  children,
  submitLabel = el.common.save,
  className = "flex flex-col gap-3",
  footerClassName = "mt-2 flex justify-end gap-2",
}: {
  action: (formData: FormData) => Promise<unknown>;
  onSuccess?: (result: unknown) => void;
  onClose: () => void;
  children: ReactNode;
  submitLabel?: ReactNode;
  className?: string;
  footerClassName?: string;
}) {
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      action={async (formData) => {
        setError(null);
        try {
          const result = await action(formData);
          const message = errorOf(result);
          if (message) {
            setError(message);
            return;
          }
          onSuccess?.(result);
          onClose();
        } catch (e) {
          setError(e instanceof Error ? e.message : el.common.error);
        }
      }}
      className={className}
    >
      {children}
      {error && (
        <p role="alert" className="border-l-2 border-negative pl-3 text-sm text-negative">
          {error}
        </p>
      )}
      <div className={footerClassName}>
        <Button type="button" variant="secondary" onClick={onClose}>
          {el.common.cancel}
        </Button>
        <SubmitButton>{submitLabel}</SubmitButton>
      </div>
    </form>
  );
}

export function FormModal({
  onClose,
  title,
  action,
  onSuccess,
  children,
  submitLabel = el.common.save,
  className,
  formClassName = "flex flex-col gap-3",
  closeOnBackdrop = false,
}: {
  onClose: () => void;
  title?: ReactNode;
  action: (formData: FormData) => Promise<unknown>;
  onSuccess?: (result: unknown) => void;
  children: ReactNode;
  submitLabel?: ReactNode;
  className?: string;
  formClassName?: string;
  closeOnBackdrop?: boolean;
}) {
  return (
    <Modal onClose={onClose} title={title} className={className} closeOnBackdrop={closeOnBackdrop}>
      <DialogForm action={action} onSuccess={onSuccess} onClose={onClose} submitLabel={submitLabel} className={formClassName}>
        {children}
      </DialogForm>
    </Modal>
  );
}
