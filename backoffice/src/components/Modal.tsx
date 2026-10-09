"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Button } from "./ui";
import { SubmitButton } from "./SubmitButton";
import { el } from "@/lib/i18n/el";
import { errorOf } from "@/lib/actions";

// One modal for the whole back office, on the native <dialog>: showModal()
// puts it in the top layer (no z-index wars), makes the page behind inert,
// and traps Tab. Escape and (optionally) a backdrop click call onClose;
// focus returns to whatever was focused when it opened.
//
// Mount it only while open (`{open && <Modal …>}`): mounting opens it,
// unmounting closes it.

const PANEL = "w-[calc(100%-2rem)] max-w-md rounded bg-white p-5";

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
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!dialog.open) dialog.showModal();
    // Escape fires "cancel": let React state decide, rather than the browser
    // closing the dialog behind its back.
    const onCancel = (e: Event) => {
      e.preventDefault();
      onCloseRef.current();
    };
    dialog.addEventListener("cancel", onCancel);
    return () => {
      dialog.removeEventListener("cancel", onCancel);
      if (dialog.open) dialog.close();
      if (previous?.isConnected) previous.focus();
    };
  }, []);

  return (
    <dialog
      ref={ref}
      aria-labelledby={title ? titleId : undefined}
      aria-modal="true"
      className={`m-auto text-ink backdrop:bg-black/40 ${className}`}
      onClick={(e) => {
        // The dialog box is the panel itself, so a click whose target is the
        // <dialog> landed on its padding or on the backdrop: tell them apart
        // by position.
        if (!closeOnBackdrop || e.target !== e.currentTarget) return;
        const r = e.currentTarget.getBoundingClientRect();
        const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
        if (!inside) onCloseRef.current();
      }}
    >
      {title && (
        <h2 id={titleId} className="mb-3 text-base font-semibold text-ink">
          {title}
        </h2>
      )}
      {children}
    </dialog>
  );
}

// A Modal around a <form action>. The action may throw or return
// { error } (see src/lib/actions.ts); either way the message is shown above
// the buttons and the dialog stays open. Anything else closes it.
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
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal onClose={onClose} title={title} className={className} closeOnBackdrop={closeOnBackdrop}>
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
        className={formClassName}
      >
        {children}
        {error && (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        )}
        <div className="mt-2 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            {el.common.cancel}
          </Button>
          <SubmitButton>{submitLabel}</SubmitButton>
        </div>
      </form>
    </Modal>
  );
}
