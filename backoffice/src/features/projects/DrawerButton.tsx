"use client";

import { useState, type ReactNode } from "react";
import { Button, FormDrawer, type ButtonSize, type ButtonVariant } from "@/components/ui";

// "Read first, edit in a drawer": a button (or the row's own title, `asLink`)
// that opens a FormDrawer around server-rendered fields. The action is a
// server action, usually bound to its row on the server.
export function DrawerButton({
  label,
  title,
  eyebrow,
  action,
  children,
  variant = "secondary",
  size = "sm",
  asLink = false,
  width,
}: {
  label: ReactNode;
  title: ReactNode;
  eyebrow?: ReactNode;
  action: (formData: FormData) => Promise<unknown>;
  children: ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  asLink?: boolean;
  width?: "md" | "lg";
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {asLink ? (
        <button type="button" onClick={() => setOpen(true)} className="text-left text-ink underline-offset-4 hover:underline">
          {label}
        </button>
      ) : (
        <Button type="button" variant={variant} size={size} onClick={() => setOpen(true)}>
          {label}
        </Button>
      )}
      {open && (
        <FormDrawer onClose={() => setOpen(false)} title={title} eyebrow={eyebrow} action={action} width={width}>
          {children}
        </FormDrawer>
      )}
    </>
  );
}
