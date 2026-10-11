import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrgId } from "@/lib/supabase/org";
import { formatDate } from "@/lib/format";
import { el } from "@/lib/i18n/el";
import { Badge, PageHeader } from "@/components/ui";
import { specRow, specTable, specTd, specTh } from "@/components/specTable";
import { UploadChooser } from "./UploadChooser";

const STATUS_TONE = { staged: "amber", committed: "green", undone: "neutral", discarded: "neutral" } as const;

export default async function InboxPage() {
  const supabase = await createClient();
  const orgId = await getCurrentOrgId(supabase);
  const [{ data: batches }, { data: accounts }] = await Promise.all([
    supabase
      .from("ingest_batches")
      .select("id, source, filename, status, row_count, period_start, period_end, created_at, accounts(name)")
      .eq("org_id", orgId)
      .order("created_at", { ascending: false })
      .limit(100),
    supabase.from("accounts").select("id, name").eq("org_id", orgId).eq("is_active", true).order("sort_order"),
  ]);

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title={el.nav.inbox}
        meta="Ό,τι μπαίνει στην εφαρμογή ξεκινά από εδώ. Ένα αντίγραφο κίνησης τράπεζας αντιστοιχίζεται με τις εκκρεμείς κινήσεις, το ελέγχετε και το οριστικοποιείτε — με δυνατότητα αναίρεσης."
      />

      <UploadChooser accounts={(accounts ?? []).map((a) => ({ id: a.id, label: a.name }))} />

      {(batches ?? []).length === 0 ? (
        <p className="border-y border-hairline py-6 text-sm text-muted">Δεν έχει ανέβει ακόμα κανένα αρχείο.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className={specTable}>
            <thead>
              <tr>
                <th scope="col" className={specTh}>Αρχείο</th>
                <th scope="col" className={`${specTh} hidden sm:table-cell`}>Λογαριασμός</th>
                <th scope="col" className={`${specTh} hidden sm:table-cell`}>Περίοδος</th>
                <th scope="col" className={`${specTh} hidden text-right md:table-cell`}>Γραμμές</th>
                <th scope="col" className={specTh}>Κατάσταση</th>
                <th scope="col" className={`${specTh} hidden text-right md:table-cell`}>Ημ/νία</th>
              </tr>
            </thead>
            <tbody>
              {(batches ?? []).map((b) => {
                const account = Array.isArray(b.accounts) ? b.accounts[0] : b.accounts;
                return (
                  <tr key={b.id} className={specRow}>
                    <td className={`${specTd} text-ink`}>
                      <Link href={`/inbox/${b.id}`} className="underline-offset-4 hover:underline">
                        {b.filename ?? el.ingest.source[b.source]}
                      </Link>
                      <div className="text-xs text-muted">{el.ingest.source[b.source]}</div>
                    </td>
                    <td className={`${specTd} hidden sm:table-cell`}>{account?.name ?? "—"}</td>
                    <td className={`${specTd} num hidden sm:table-cell`}>
                      {b.period_start ? `${formatDate(b.period_start)} – ${formatDate(b.period_end)}` : "—"}
                    </td>
                    <td className={`${specTd} num hidden text-right md:table-cell`}>{b.row_count}</td>
                    <td className={specTd}>
                      <Badge tone={STATUS_TONE[b.status]}>{el.ingest.batchStatus[b.status]}</Badge>
                    </td>
                    <td className={`${specTd} num hidden text-right md:table-cell`}>{formatDate(b.created_at)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
