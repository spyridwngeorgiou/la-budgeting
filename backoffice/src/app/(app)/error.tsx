"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui";
import { shell } from "@/lib/i18n/v2/shell";

// A page that breaks must not be a dead end: «Δοκιμάστε ξανά» re-renders it.
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
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
        </div>
      </div>
    </div>
  );
}
