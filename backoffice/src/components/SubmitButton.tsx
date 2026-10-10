"use client";

import { useFormStatus } from "react-dom";
import { Button, type ButtonSize, type ButtonVariant } from "./ui/Button";
import type { ButtonHTMLAttributes } from "react";

// useFormStatus only reports the nearest enclosing <form>'s pending state
// when called from a component that is itself a CHILD of that form -- it
// cannot be read in the same component that renders the <form> tag. Kept
// out of ui/Button (imported by both server and client components) since
// this one requires a client boundary.
export function SubmitButton({
  children,
  pendingLabel = "…",
  variant,
  size,
  disabled,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  pendingLabel?: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
}) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={variant} size={size} {...props} disabled={pending || disabled}>
      {pending ? pendingLabel : children}
    </Button>
  );
}
