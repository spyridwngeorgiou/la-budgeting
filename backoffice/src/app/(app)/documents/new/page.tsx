import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrg } from "@/lib/supabase/org";
import { aiEnabled } from "@/lib/ai/client";
import { EntryTabs } from "./EntryTabs";
import { el } from "@/lib/i18n/el";

export default async function NewDocumentPage({ searchParams }: { searchParams: Promise<{ mode?: string }> }) {
  const { mode } = await searchParams;
  const supabase = await createClient();
  const org = await getCurrentOrg(supabase);

  if (!aiEnabled()) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="border-b border-rule pb-4 text-title font-normal text-ink">Kansha Operator</h1>
        <div className="border-l-2 border-warning py-1 pl-4 text-sm text-warning">
          Ο βοηθός AI δεν είναι ακόμα ενεργοποιημένος. Χρειάζεται ANTHROPIC_API_KEY και
          AI_ENABLED=true στις μεταβλητές περιβάλλοντος.
        </div>
      </div>
    );
  }

  const ownAfmMissing = !org?.own_afm || org.own_afm === "000000000";

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1.5 border-b border-rule pb-4">
        <Link href="/inbox" className="eyebrow inline-flex min-h-8 items-center text-muted hover:text-ink">
          ← {el.nav.inbox}
        </Link>
        <h1 className="text-title font-normal text-ink">Νέα κίνηση</h1>
        <p className="text-small text-muted">
          Το AI συμπληρώνει τα στοιχεία — εσείς τα ελέγχετε πριν καταχωρηθούν.
        </p>
      </div>

      {ownAfmMissing && (
        <div className="border-l-2 border-warning py-1 pl-4 text-sm text-warning">
          Συνιστάται να ορίσετε πρώτα το ΑΦΜ της επιχείρησης στις{" "}
          <Link href="/settings" className="underline underline-offset-4 hover:text-ink">
            Ρυθμίσεις
          </Link>
          .
        </div>
      )}

      <EntryTabs initial={mode === "text" ? "text" : "photo"} />

      <p className="text-xs text-muted">
        Για αλλαγές σε λογαριασμούς, έργα, επαφές ή δόσεις (π.χ. «άλλαξε το όνομα της επαφής Χ») χρησιμοποιήστε το{" "}
        <Link href="/assistant" className="underline underline-offset-4 hover:text-ink">
          Kansha AI
        </Link>
        · κάθε πρόταση περνάει από{" "}
        <Link href="/assistant?panel=changes" className="underline underline-offset-4 hover:text-ink">
          έγκριση
        </Link>
        .
      </p>
    </div>
  );
}
