"use client";

import { useEffect } from "react";
import { Card, Button } from "@/components/ui";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex flex-1 items-center justify-center py-16">
      <Card className="max-w-md text-center">
        <h1 className="text-lg font-semibold">Κάτι πήγε στραβά</h1>
        <p className="mt-2 text-sm text-ink-muted">
          Παρουσιάστηκε ένα απρόσμενο σφάλμα. Δοκιμάστε ξανά, ή επιστρέψτε αργότερα.
        </p>
        {error.digest && <p className="mt-2 text-xs text-ink-faint">Κωδικός: {error.digest}</p>}
        <Button className="mt-4" onClick={reset}>
          Δοκιμάστε ξανά
        </Button>
      </Card>
    </div>
  );
}
