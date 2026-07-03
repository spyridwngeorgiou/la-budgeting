"use client";

import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui";

/** A delete form with a confirmation prompt. `action` is a server action. */
export function DeleteButton({
  action,
  id,
  confirmText = "Επιβεβαίωση διαγραφής;",
}: {
  action: (formData: FormData) => void;
  id: string;
  confirmText?: string;
}) {
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!confirm(confirmText)) e.preventDefault();
      }}
    >
      <input type="hidden" name="id" value={id} />
      <Button variant="ghost" type="submit" aria-label="Διαγραφή">
        <Trash2 size={16} className="text-negative" />
      </Button>
    </form>
  );
}
