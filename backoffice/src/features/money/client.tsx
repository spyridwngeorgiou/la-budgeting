"use client";

import { useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { FormDrawer, MenuItem } from "@/components/ui";
import { errorOf } from "@/lib/actions";
import { getSourceDocumentUrl } from "@/app/(app)/transactions/actions";
import { money } from "@/lib/i18n/v2/money";

// The drawers of «Χρήματα» are URLs: a row's «Επεξεργασία» is a link to
// ?edit=<id> (kept with the filters by withParams), the page renders the
// drawer with that row's fields, and closing replaces the URL back. So a
// drawer survives a reload and can be shared, and the server renders the
// fields with the row it just read.
export function UrlDrawer({
  title,
  eyebrow,
  action,
  closeHref,
  submitLabel,
  children,
}: {
  title: ReactNode;
  eyebrow?: ReactNode;
  action: (formData: FormData) => Promise<unknown>;
  closeHref: string;
  submitLabel?: ReactNode;
  children: ReactNode;
}) {
  const router = useRouter();
  return (
    <FormDrawer
      title={title}
      eyebrow={eyebrow}
      action={action}
      submitLabel={submitLabel}
      onClose={() => router.replace(closeHref, { scroll: false })}
    >
      {children}
    </FormDrawer>
  );
}

// A «⋯» menu item that runs one server action (Πληρώθηκε, Διαγραφή …); a
// returned { error } is shown, not lost.
export function RowAction({
  action,
  confirm,
  tone,
  children,
}: {
  action: () => Promise<unknown>;
  confirm?: string;
  tone?: "danger";
  children: ReactNode;
}) {
  const [pending, start] = useTransition();
  return (
    <MenuItem
      tone={tone}
      disabled={pending}
      onClick={() => {
        if (confirm && !window.confirm(confirm)) return;
        start(async () => {
          const message = errorOf(await action());
          if (message) window.alert(message);
        });
      }}
    >
      {children}
    </MenuItem>
  );
}

// «Πρωτότυπο»: a short-lived signed URL, fetched on click.
export function SourceDocumentItem({ transactionId }: { transactionId: string }) {
  const [pending, start] = useTransition();
  return (
    <MenuItem
      disabled={pending}
      onClick={() =>
        start(async () => {
          const url = await getSourceDocumentUrl(transactionId);
          if (url) window.open(url, "_blank", "noopener,noreferrer");
          else window.alert(money.tx.sourceGone);
        })
      }
    >
      {money.tx.source}
    </MenuItem>
  );
}
