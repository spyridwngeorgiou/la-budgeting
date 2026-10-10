"use client";

import { useEffect, useRef, type MouseEvent } from "react";

// Shared by Modal and Drawer, on the native <dialog>: showModal() puts it in
// the top layer (no z-index wars), makes the page behind inert and traps
// Tab. Escape and (optionally) a backdrop click call onClose; focus returns
// to whatever was focused when it opened.
//
// Mount the dialog only while open (`{open && <Drawer …>}`): mounting opens
// it, unmounting closes it.
export function useDialog(onClose: () => void, closeOnBackdrop: boolean) {
  const ref = useRef<HTMLDialogElement>(null);
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

  // The dialog box is the panel itself, so a click whose target is the
  // <dialog> landed on its padding or on the backdrop: tell them apart by
  // position.
  const onClick = (e: MouseEvent<HTMLDialogElement>) => {
    if (!closeOnBackdrop || e.target !== e.currentTarget) return;
    const r = e.currentTarget.getBoundingClientRect();
    const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    if (!inside) onCloseRef.current();
  };

  return { ref, onClick, close: () => onCloseRef.current() };
}
