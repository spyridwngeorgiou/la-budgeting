"use client";

import { useEffect, useTransition } from "react";
import { Button } from "@/components/ui";
import { shell } from "@/lib/i18n/v2/shell";
import { setUiVersion } from "@/lib/ui/actions";

// A page that breaks must not be a dead end, least of all while the new
// shell is being rolled out: besides «Δοκιμάστε ξανά» there is always the
// way back to the classic look (a full reload, so the old shell renders
// from scratch).
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const [pending, startTransition] = useTransition();
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex flex-1 items-start justify-center py-16">
      <div className="flex w-full max-w-md flex-col gap-3">
        <h1 className="border-b border-rule pb-3 text-title font-normal text-ink">{shell.error.title}</h1>
        <p className="text-sm text-text">{shell.error.body}</p>
        {error.digest && (
          <p className="text-xs text-muted">
            {shell.error.code}: <span className="num">{error.digest}</span>
          </p>
        )}
        <div className="mt-2 flex flex-wrap gap-2">
          <Button onClick={reset}>{shell.error.retry}</Button>
          <Button
            variant="secondary"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                await setUiVersion("v1");
                window.location.reload();
              })
            }
          >
            {shell.error.classic}
          </Button>
        </div>
      </div>
    </div>
  );
}
