"use client";

import { SubmitButton } from "@/components/SubmitButton";
import { errorOf } from "@/lib/actions";

// A form whose submit asks first -- for the irreversible delete.
export function ConfirmSubmit({
  action,
  confirmText,
  children,
}: {
  action: () => Promise<unknown>;
  confirmText: string;
  children: React.ReactNode;
}) {
  return (
    <form
      action={async () => {
        const message = errorOf(await action());
        if (message) window.alert(message);
      }}
      onSubmit={(e) => {
        if (!window.confirm(confirmText)) e.preventDefault();
      }}
    >
      <SubmitButton variant="danger">{children}</SubmitButton>
    </form>
  );
}
