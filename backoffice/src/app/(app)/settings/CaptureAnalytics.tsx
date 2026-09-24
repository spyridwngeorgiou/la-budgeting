import { createClient } from "@/lib/supabase/server";
import { Card } from "@/components/ui";
import { formatMoney } from "@/lib/format";

const FEATURE_LABELS: Record<string, string> = {
  document_extraction: "Ανάγνωση Παραστατικού (φωτό)",
  nl_entry: "Καταχώρηση με Κείμενο/Φωνή",
  assistant: "Kansha AI (chat)",
  dashboard_summary: "Περίληψη Κέντρου Ελέγχου",
  project_health: "Έλεγχος Υγείας Έργου",
  revenue_plan_creation: "Δημιουργία Εκτίμησης Εσόδων",
};

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

  const [{ data: usage }, { data: approvedDrafts }, { data: corrections }] = await Promise.all([
    supabase.from("ai_usage").select("feature, latency_ms, cost_cents").order("created_at", { ascending: false }).limit(5000),
    supabase.from("transaction_drafts").select("id, source").eq("status", "approved").in("source", ["ai_document", "ai_nl"]),
    supabase.from("ai_corrections").select("draft_id").not("draft_id", "is", null),
  ]);

  if (!usage || usage.length === 0) {
    return (
      <Card className="max-w-2xl">
        <h2 className="mb-1 text-sm font-medium text-ink-muted">Ανάλυση Καταγραφής AI</h2>
        <p className="text-sm text-ink-faint">
          Καμία χρήση AI ακόμα. Αυτή η ενότητα γεμίζει μόλις αρχίσετε να χρησιμοποιείτε το Kansha
          Operator για πραγματικές κινήσεις.
        </p>
      </Card>
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
  const correctedDraftIds = new Set((corrections ?? []).map((c) => c.draft_id));
  const editRateBySource = (source: "ai_document" | "ai_nl") => {
    const drafts = (approvedDrafts ?? []).filter((d) => d.source === source);
    if (drafts.length === 0) return null;
    const edited = drafts.filter((d) => correctedDraftIds.has(d.id)).length;
    return { edited, total: drafts.length };
  };

  return (
    <Card className="max-w-2xl">
      <h2 className="mb-1 text-sm font-medium text-ink-muted">Ανάλυση Καταγραφής AI</h2>
      <p className="mb-3 text-xs text-ink-faint">
        Ταχύτητα και ακρίβεια ανά λειτουργία AI, από τις πραγματικές κλήσεις.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-ink-muted">
            <tr>
              <th className="py-1 pr-4 font-medium">Λειτουργία</th>
              <th className="py-1 pr-4 text-right font-medium">Κλήσεις</th>
              <th className="py-1 pr-4 text-right font-medium">Μέση Ταχύτητα</th>
              <th className="py-1 pr-4 text-right font-medium">Ποσοστό Επεξεργασίας</th>
              <th className="py-1 text-right font-medium">Κόστος</th>
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
                <tr key={feature} className="border-t border-line">
                  <td className="py-1.5 pr-4">{FEATURE_LABELS[feature] ?? feature}</td>
                  <td className="py-1.5 pr-4 text-right font-mono">{stats.count}</td>
                  <td className="py-1.5 pr-4 text-right font-mono">
                    {med != null ? `${(med / 1000).toFixed(1)}s` : "—"}
                  </td>
                  <td className="py-1.5 pr-4 text-right font-mono">
                    {editRate ? `${Math.round((editRate.edited / editRate.total) * 100)}%` : "—"}
                  </td>
                  <td className="py-1.5 text-right font-mono">{formatMoney(stats.costCents / 100)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-ink-faint">
        «Ποσοστό Επεξεργασίας» = πόσες εγκεκριμένες κινήσεις χρειάστηκαν διόρθωση πριν καταχωρηθούν
        (μόνο για φωτό/κείμενο-φωνή).
      </p>
    </Card>
  );
}
