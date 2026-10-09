"use client";

import { SubmitButton } from "@/components/SubmitButton";

// A form whose submit asks first -- for the irreversible delete.
export function ConfirmSubmit({
  action,
  confirmText,
  children,
}: {
  action: () => Promise<void>;
  confirmText: string;
  children: React.ReactNode;
}) {
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!window.confirm(confirmText)) e.preventDefault();
      }}
    >
      <SubmitButton variant="danger">{children}</SubmitButton>
    </form>
  );
}
