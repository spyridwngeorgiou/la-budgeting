import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrg } from "@/lib/supabase/org";
import { aiEnabled } from "@/lib/ai/client";
import { EntryTabs } from "./EntryTabs";

export default async function NewDocumentPage() {
  const supabase = await createClient();
  const org = await getCurrentOrg(supabase);

  if (!aiEnabled()) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-xl font-semibold">Kansha Operator</h1>
        <div className="rounded-lg border border-amber-ink/40 bg-amber-bg p-4 text-sm text-amber-ink">
          Ο βοηθός AI δεν είναι ακόμα ενεργοποιημένος. Χρειάζεται ANTHROPIC_API_KEY και
          AI_ENABLED=true στις μεταβλητές περιβάλλοντος.
        </div>
      </div>
    );
  }

  const ownAfmMissing = !org?.own_afm || org.own_afm === "000000000";

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold">Νέα κίνηση</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Το AI συμπληρώνει τα στοιχεία — εσείς τα ελέγχετε πριν καταχωρηθούν.
        </p>
      </div>

      {ownAfmMissing && (
        <div className="rounded-lg border border-amber-ink/40 bg-amber-bg p-3 text-sm text-amber-ink">
          Συνιστάται να ορίσετε πρώτα το ΑΦΜ της επιχείρησης στις{" "}
          <Link href="/settings" className="underline">
            Ρυθμίσεις
          </Link>
          .
        </div>
      )}

      <EntryTabs />

      <p className="text-xs text-ink-faint">
        Για αλλαγές σε λογαριασμούς, έργα, επαφές ή δόσεις (π.χ. «άλλαξε το όνομα της επαφής Χ») χρησιμοποιήστε το{" "}
        <Link href="/assistant" className="underline">
          Kansha AI
        </Link>
        · κάθε πρόταση περνάει από{" "}
        <Link href="/changes" className="underline">
          έγκριση
        </Link>
        .
      </p>
    </div>
  );
}
