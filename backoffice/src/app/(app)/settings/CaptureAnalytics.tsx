import { createClient } from "@/lib/supabase/server";
import { SectionHeader } from "@/components/ui";
import { specRow, specTable, specTd, specTh } from "@/components/specTable";
import { formatMoney } from "@/lib/format";
import { getCurrentOrgId } from "@/lib/supabase/org";
import { ingestUnified } from "@/lib/ingest/flag";

const FEATURE_LABELS: Record<string, string> = {
  document_extraction: "Ανάγνωση Παραστατικού (φωτό)",
  nl_entry: "Καταχώρηση με Κείμενο/Φωνή",
  assistant: "Kansha AI (chat)",
  dashboard_summary: "Περίληψη Κέντρου Ελέγχου",
  project_health: "Έλεγχος Υγείας Έργου",
  revenue_plan_creation: "Δημιουργία Εκτίμησης Εσόδων",
};

type Client = Awaited<ReturnType<typeof createClient>>;

// Approved AI captures and which of them a human corrected. Old path:
// approved transaction_drafts + ai_corrections.draft_id. INGEST_UNIFIED:
// committed «Νέα κίνηση» rows of ai_* batches + ai_corrections.ingest_row_id
// (0072 backfills the old drafts and their corrections onto the same ids, so
// history is not lost at cutover).
async function loadApprovals(
  supabase: Client,
  orgId: string,
): Promise<{ approvedDrafts: { id: string; source: string }[]; corrections: string[] }> {
  if (ingestUnified()) {
    const [{ data: rows }, { data: corrections }] = await Promise.all([
      supabase
        .from("ingest_rows")
        .select("id, ingest_batches!inner(source)")
        .eq("org_id", orgId)
        .eq("decision", "create")
        .not("committed_at", "is", null)
        .in("ingest_batches.source", ["ai_document", "ai_nl"]),
      supabase.from("ai_corrections").select("ingest_row_id").eq("org_id", orgId).not("ingest_row_id", "is", null),
    ]);
    return {
      approvedDrafts: (rows ?? []).map((r) => {
        const batch = Array.isArray(r.ingest_batches) ? r.ingest_batches[0] : r.ingest_batches;
        return { id: r.id, source: batch?.source ?? "" };
      }),
      corrections: (corrections ?? []).map((c) => c.ingest_row_id!),
    };
  }
  const [{ data: drafts }, { data: corrections }] = await Promise.all([
    supabase.from("transaction_drafts").select("id, source").eq("org_id", orgId).eq("status", "approved").in("source", ["ai_document", "ai_nl"]),
    supabase.from("ai_corrections").select("draft_id").eq("org_id", orgId).not("draft_id", "is", null),
  ]);
  return { approvedDrafts: drafts ?? [], corrections: (corrections ?? []).map((c) => c.draft_id!) };
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

// The Kansha Operator (photo/text/voice capture) has never run against real
// use -- this is the surface that answers the roadmap's actual question,
// "does capture take 8 seconds or 80, and how often is it right", once both
// users start using it for real. Reuses ai_usage (already logged on every
// AI call) and ai_corrections (already logged on every human edit at
// approval) rather than building new infrastructure -- only latency_ms and
// draft_id (migration 0022) were new.
export async function CaptureAnalytics() {
  const supabase = await createClient();
  const orgId = await getCurrentOrgId(supabase);

  const [{ data: usage }, { approvedDrafts, corrections }] = await Promise.all([
    supabase.from("ai_usage").select("feature, latency_ms, cost_cents").eq("org_id", orgId).order("created_at", { ascending: false }).limit(5000),
    loadApprovals(supabase, orgId),
  ]);

  if (!usage || usage.length === 0) {
    return (
      <section className="flex w-full max-w-2xl flex-col gap-4">
        <SectionHeader title="Ανάλυση Καταγραφής AI" />
        <p className="text-sm text-muted">
          Καμία χρήση AI ακόμα. Αυτή η ενότητα γεμίζει μόλις αρχίσετε να χρησιμοποιείτε το Kansha
          Operator για πραγματικές κινήσεις.
        </p>
      </section>
    );
  }

  const byFeature = new Map<string, { count: number; latencies: number[]; costCents: number }>();
  for (const row of usage) {
    const entry = byFeature.get(row.feature) ?? { count: 0, latencies: [], costCents: 0 };
    entry.count += 1;
    if (row.latency_ms != null) entry.latencies.push(row.latency_ms);
    entry.costCents += Number(row.cost_cents ?? 0);
    byFeature.set(row.feature, entry);
  }

  // draft_id was only added alongside latency_ms (migration 0022) -- drafts
  // approved before that will always show as "no correction found" here
  // even if they were edited, since no correction row could reference them
  // yet. Only a skew for historical data; every approval from now on is accurate.
  const correctedDraftIds = new Set(corrections);
  const editRateBySource = (source: "ai_document" | "ai_nl") => {
    const drafts = approvedDrafts.filter((d) => d.source === source);
    if (drafts.length === 0) return null;
    const edited = drafts.filter((d) => correctedDraftIds.has(d.id)).length;
    return { edited, total: drafts.length };
  };

  return (
    <section className="flex w-full max-w-2xl flex-col gap-4">
      <SectionHeader title="Ανάλυση Καταγραφής AI" />
      <p className="text-xs text-muted">
        Ταχύτητα και ακρίβεια ανά λειτουργία AI, από τις πραγματικές κλήσεις.
      </p>
      <div className="overflow-x-auto">
        <table className={specTable}>
          <thead>
            <tr>
              <th scope="col" className={specTh}>Λειτουργία</th>
              <th scope="col" className={`${specTh} text-right`}>Κλήσεις</th>
              <th scope="col" className={`${specTh} text-right`}>Μέση Ταχύτητα</th>
              <th scope="col" className={`${specTh} text-right`}>Ποσοστό Επεξεργασίας</th>
              <th scope="col" className={`${specTh} text-right`}>Κόστος</th>
            </tr>
          </thead>
          <tbody>
            {[...byFeature.entries()].map(([feature, stats]) => {
              const med = median(stats.latencies);
              const editRate =
                feature === "document_extraction"
                  ? editRateBySource("ai_document")
                  : feature === "nl_entry"
                    ? editRateBySource("ai_nl")
                    : null;
              return (
                <tr key={feature} className={specRow}>
                  <td className={`${specTd} text-ink`}>{FEATURE_LABELS[feature] ?? feature}</td>
                  <td className={`${specTd} num text-right`}>{stats.count}</td>
                  <td className={`${specTd} num text-right`}>
                    {med != null ? `${(med / 1000).toFixed(1)}s` : "—"}
                  </td>
                  <td className={`${specTd} num text-right`}>
                    {editRate ? `${Math.round((editRate.edited / editRate.total) * 100)}%` : "—"}
                  </td>
                  <td className={`${specTd} num text-right`}>{formatMoney(stats.costCents / 100)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted">
        «Ποσοστό Επεξεργασίας» = πόσες εγκεκριμένες κινήσεις χρειάστηκαν διόρθωση πριν καταχωρηθούν
        (μόνο για φωτό/κείμενο-φωνή).
      </p>
    </section>
  );
}
