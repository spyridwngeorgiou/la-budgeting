import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrgId } from "@/lib/supabase/org";
import { formatDate } from "@/lib/format";
import { el } from "@/lib/i18n/el";
import { Badge } from "@/components/ui";
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
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold">{el.nav.inbox}</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Ό,τι μπαίνει στην εφαρμογή ξεκινά από εδώ. Ένα αντίγραφο κίνησης τράπεζας αντιστοιχίζεται με τις
          εκκρεμείς κινήσεις, το ελέγχετε και το οριστικοποιείτε — με δυνατότητα αναίρεσης.
        </p>
      </div>

      <UploadChooser accounts={(accounts ?? []).map((a) => ({ id: a.id, label: a.name }))} />

      {(batches ?? []).length === 0 ? (
        <p className="p-6 text-center text-sm text-ink-muted">Δεν έχει ανέβει ακόμα κανένα αρχείο.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line">
          <table className="w-full text-left text-sm">
            <thead className="bg-bg text-ink-muted">
              <tr>
                <th className="p-2">Αρχείο</th>
                <th className="hidden p-2 sm:table-cell">Λογαριασμός</th>
                <th className="hidden p-2 sm:table-cell">Περίοδος</th>
                <th className="hidden p-2 text-right md:table-cell">Γραμμές</th>
                <th className="p-2">Κατάσταση</th>
                <th className="hidden p-2 md:table-cell">Ημ/νία</th>
              </tr>
            </thead>
            <tbody>
              {(batches ?? []).map((b) => {
                const account = Array.isArray(b.accounts) ? b.accounts[0] : b.accounts;
                return (
                  <tr key={b.id} className="border-t border-line">
                    <td className="p-2">
                      <Link href={`/inbox/${b.id}`} className="hover:underline">
                        {b.filename ?? b.source}
                      </Link>
                    </td>
                    <td className="hidden p-2 sm:table-cell">{account?.name ?? "—"}</td>
                    <td className="hidden p-2 sm:table-cell">
                      {b.period_start ? `${formatDate(b.period_start)} – ${formatDate(b.period_end)}` : "—"}
                    </td>
                    <td className="hidden p-2 text-right md:table-cell">{b.row_count}</td>
                    <td className="p-2">
                      <Badge tone={STATUS_TONE[b.status]}>{el.ingest.batchStatus[b.status]}</Badge>
                    </td>
                    <td className="hidden p-2 md:table-cell">{formatDate(b.created_at)}</td>
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
