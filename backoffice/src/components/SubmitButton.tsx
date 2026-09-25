"use client";

import { useFormStatus } from "react-dom";
import { Button } from "./ui";
import type { ButtonHTMLAttributes } from "react";

// useFormStatus only reports the nearest enclosing <form>'s pending state
// when called from a component that is itself a CHILD of that form -- it
// cannot be read in the same component that renders the <form> tag. Kept
// out of ui.tsx (imported by both server and client components) since this
// one requires a client boundary.
export function SubmitButton({
  children,
  pendingLabel = "…",
  variant,
  disabled,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  pendingLabel?: string;
  variant?: "primary" | "secondary" | "danger" | "ai" | "aiSolid";
}) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={variant} {...props} disabled={pending || disabled}>
      {pending ? pendingLabel : children}
    </Button>
  );
}
