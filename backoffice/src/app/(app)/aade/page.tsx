import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrg, getCurrentOrgId } from "@/lib/supabase/org";
import { formatDate } from "@/lib/format";
import { el } from "@/lib/i18n/el";
import { Badge } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";
import { uploadAadeFile } from "./actions";
import { ActionForm } from "@/components/ActionForm";
import { specRow, specTable, specTd, specTh } from "@/components/specTable";

const STATUS_LABEL = { draft: "Πρόχειρο", committed: "Ολοκληρώθηκε", discarded: "Απορρίφθηκε" } as const;
const STATUS_TONE = { draft: "amber", committed: "green", discarded: "neutral" } as const;

export default async function AadePage() {
  const supabase = await createClient();

  // Independent of each other -- run in parallel rather than one after the other.
  const [org, { data: batches }] = await Promise.all([
    getCurrentOrg(supabase),
    getCurrentOrgId(supabase).then((orgId) =>
      supabase.from("aade_import_batches").select("*").eq("org_id", orgId).order("uploaded_at", { ascending: false }),
    ),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1.5 border-b border-rule pb-4">
        <Link href="/inbox" className="eyebrow inline-flex min-h-8 items-center text-muted hover:text-ink">
          ← {el.nav.inbox}
        </Link>
        <h1 className="text-title font-normal text-ink">{el.nav.aade}</h1>
        <p className="text-small text-muted">
          Ανεβάστε το αρχείο εξαγωγής myDATA/AADE για να ελέγξετε και να εισάγετε παραστατικά μαζικά.
        </p>
      </div>

      {(!org?.own_afm || org.own_afm === "000000000") && (
        <div className="border-l-2 border-warning py-1 pl-4 text-sm text-warning">
          Ορίστε πρώτα το πραγματικό ΑΦΜ της επιχείρησης στις{" "}
          <Link href="/settings" className="underline underline-offset-4">
            Ρυθμίσεις
          </Link>{" "}
          — χρειάζεται για να καθοριστεί σωστά η κατεύθυνση (έσοδο/έξοδο) κάθε κίνησης.
        </div>
      )}

      <ActionForm action={uploadAadeFile} className="flex flex-wrap items-center gap-2 border-b border-hairline pb-4">
        <input
          type="file"
          name="file"
          accept=".xlsx"
          required
          className="min-h-10 min-w-0 text-sm text-text file:mr-3 file:min-h-10 file:border file:border-chip-border file:bg-transparent file:px-3 file:text-sm file:text-ink hover:file:border-navy"
        />
        <SubmitButton pendingLabel="Εισαγωγή…">Εισαγωγή Αρχείου myDATA</SubmitButton>
      </ActionForm>

      {(batches ?? []).length === 0 ? (
        <p className="border-y border-hairline py-6 text-sm text-muted">
          Δεν έχει γίνει ακόμα καμία εισαγωγή. Ανεβάστε ένα αρχείο myDATA (.xlsx) παραπάνω.
        </p>
      ) : (
      <div className="overflow-x-auto">
        <table className={specTable}>
          <thead>
            <tr>
              <th scope="col" className={specTh}>Αρχείο</th>
              <th scope="col" className={`${specTh} hidden sm:table-cell`}>Περίοδος</th>
              <th scope="col" className={`${specTh} hidden text-right sm:table-cell`}>Γραμμές</th>
              <th scope="col" className={`${specTh} hidden text-right md:table-cell`}>Νέες</th>
              <th scope="col" className={`${specTh} hidden text-right md:table-cell`}>Διπλότυπες</th>
              <th scope="col" className={specTh}>Κατάσταση</th>
              <th scope="col" className={`${specTh} hidden text-right md:table-cell`}>Ημ/νία</th>
            </tr>
          </thead>
          <tbody>
            {(batches ?? []).map((b) => (
              <tr key={b.id} className={specRow}>
                <td className={`${specTd} text-ink`}>
                  <Link href={`/aade/${b.id}`} className="underline-offset-4 hover:underline">
                    {b.filename}
                  </Link>
                </td>
                <td className={`${specTd} hidden sm:table-cell`}>{b.period ?? "—"}</td>
                <td className={`${specTd} num hidden text-right sm:table-cell`}>{b.row_count}</td>
                <td className={`${specTd} num hidden text-right md:table-cell`}>{b.new_count ?? "—"}</td>
                <td className={`${specTd} num hidden text-right md:table-cell`}>{b.dup_count ?? "—"}</td>
                <td className={specTd}>
                  <Badge tone={STATUS_TONE[b.status as keyof typeof STATUS_TONE]}>
                    {STATUS_LABEL[b.status as keyof typeof STATUS_LABEL]}
                  </Badge>
                </td>
                <td className={`${specTd} num hidden text-right text-xs text-muted md:table-cell`}>{formatDate(b.uploaded_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      )}
    </div>
  );
}
