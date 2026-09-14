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
        <div className="rounded border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800">
          Ο βοηθός AI δεν είναι ακόμα ενεργοποιημένος. Χρειάζεται ANTHROPIC_API_KEY και
          AI_ENABLED=true στις μεταβλητές περιβάλλοντος.
        </div>
      </div>
    );
  }

  const ownAfmMissing = !org?.own_afm || org.own_afm === "000000000";

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Kansha Operator</h1>
      <p className="text-sm text-ink-muted">
        Ανεβάστε φωτογραφία απόδειξης/τιμολογίου, ή πείτε/γράψτε την κίνηση με απλά λόγια, για νέες
        κινήσεις — τίποτα δεν καταχωρείται αυτόματα χωρίς έλεγχο. Για αλλαγές σε λογαριασμούς, έργα,
        επαφές ή πλάνα δόσεων (π.χ. «άλλαξε το όνομα της επαφής Χ»), μιλήστε στο{" "}
        <Link href="/assistant" className="underline">
          Kansha AI
        </Link>{" "}
        — κάθε πρόταση περνάει από{" "}
        <Link href="/changes" className="underline">
          έγκριση
        </Link>{" "}
        πριν εφαρμοστεί.
      </p>

      {ownAfmMissing && (
        <div className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
          Συνιστάται να ορίσετε πρώτα το ΑΦΜ της επιχείρησης στις{" "}
          <Link href="/settings" className="underline">
            Ρυθμίσεις
          </Link>
          .
        </div>
      )}

      <EntryTabs />
    </div>
  );
}
