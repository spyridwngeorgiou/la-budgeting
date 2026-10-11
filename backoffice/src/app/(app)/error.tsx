"use client";

import { useEffect } from "react";
import { Button, PageHeader } from "@/components/ui";
import { shell } from "@/lib/i18n/v2/shell";

// A page that breaks must not be a dead end: «Δοκιμάστε ξανά» re-renders it.
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex flex-col gap-10">
      <PageHeader title={shell.error.title} />
      <div className="flex max-w-prose flex-col gap-4">
        <p className="text-body text-text">{shell.error.body}</p>
        {error.digest && (
          <p className="text-small text-muted">
            {shell.error.code}: <span className="num">{error.digest}</span>
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button onClick={reset}>{shell.error.retry}</Button>
        </div>
      </div>
    </div>
  );
}
