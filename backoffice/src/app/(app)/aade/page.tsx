import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrg } from "@/lib/supabase/org";
import { formatDate } from "@/lib/format";
import { el } from "@/lib/i18n/el";
import { Badge } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";
import { uploadAadeFile } from "./actions";

const STATUS_LABEL = { draft: "Πρόχειρο", committed: "Ολοκληρώθηκε", discarded: "Απορρίφθηκε" } as const;
const STATUS_TONE = { draft: "amber", committed: "green", discarded: "neutral" } as const;

export default async function AadePage() {
  const supabase = await createClient();

  // Independent of each other -- run in parallel rather than one after the
  // other (org lookup doesn't gate the batches query; RLS scopes both).
  const [org, { data: batches }] = await Promise.all([
    getCurrentOrg(supabase),
    supabase.from("aade_import_batches").select("*").order("uploaded_at", { ascending: false }),
  ]);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold">{el.nav.aade}</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Ανεβάστε το αρχείο εξαγωγής myDATA/AADE για να ελέγξετε και να εισάγετε παραστατικά μαζικά.
        </p>
      </div>

      {(!org?.own_afm || org.own_afm === "000000000") && (
        <div className="rounded border border-amber-ink/40 bg-amber-bg p-3 text-sm text-amber-ink">
          Ορίστε πρώτα το πραγματικό ΑΦΜ της επιχείρησης στις{" "}
          <Link href="/settings" className="underline">
            Ρυθμίσεις
          </Link>{" "}
          — χρειάζεται για να καθοριστεί σωστά η κατεύθυνση (έσοδο/έξοδο) κάθε κίνησης.
        </div>
      )}

      <form action={uploadAadeFile} className="flex items-center gap-2 rounded border border-line p-4">
        <input type="file" name="file" accept=".xlsx" required className="text-sm" />
        <SubmitButton pendingLabel="Εισαγωγή…">Εισαγωγή Αρχείου myDATA</SubmitButton>
      </form>

      {(batches ?? []).length === 0 ? (
        <p className="p-6 text-center text-sm text-ink-muted">
          Δεν έχει γίνει ακόμα καμία εισαγωγή. Ανεβάστε ένα αρχείο myDATA (.xlsx) παραπάνω.
        </p>
      ) : (
      <div className="overflow-x-auto rounded border border-line">
        <table className="w-full text-left text-sm">
          <thead className="bg-bg text-ink-muted">
            <tr>
              <th className="p-2">Αρχείο</th>
              <th className="hidden p-2 sm:table-cell">Περίοδος</th>
              <th className="hidden p-2 text-right sm:table-cell">Γραμμές</th>
              <th className="hidden p-2 text-right md:table-cell">Νέες</th>
              <th className="hidden p-2 text-right md:table-cell">Διπλότυπες</th>
              <th className="p-2">Κατάσταση</th>
              <th className="hidden p-2 md:table-cell">Ημ/νία</th>
            </tr>
          </thead>
          <tbody>
            {(batches ?? []).map((b) => (
              <tr key={b.id} className="border-t border-line">
                <td className="p-2">
                  <Link href={`/aade/${b.id}`} className="hover:underline">
                    {b.filename}
                  </Link>
                </td>
                <td className="hidden p-2 sm:table-cell">{b.period ?? "—"}</td>
                <td className="hidden p-2 text-right sm:table-cell">{b.row_count}</td>
                <td className="hidden p-2 text-right md:table-cell">{b.new_count ?? "—"}</td>
                <td className="hidden p-2 text-right md:table-cell">{b.dup_count ?? "—"}</td>
                <td className="p-2">
                  <Badge tone={STATUS_TONE[b.status as keyof typeof STATUS_TONE]}>
                    {STATUS_LABEL[b.status as keyof typeof STATUS_LABEL]}
                  </Badge>
                </td>
                <td className="hidden p-2 text-xs text-ink-muted md:table-cell">{formatDate(b.uploaded_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      )}
    </div>
  );
}
