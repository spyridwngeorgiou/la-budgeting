import { createClient } from "@/lib/supabase/server";
import { getCurrentOrgId } from "@/lib/supabase/org";
import { formatDate } from "@/lib/format";
import { Badge, AiSpark } from "@/components/ui";
import { OP_LABEL, STATUS_LABEL, tableLabel, toChangeCard, type ChangeOperation, type ChangeStatus } from "@/lib/ai/changeCards";
import { el } from "@/lib/i18n/el";
import { ChangeCardView } from "./ChangeCardView";

const CHANGE_COLUMNS =
  "id, status, operation, table_name, action, reason, before, after, changed_fields, conflict, untrusted_context, error, result, created_at";

// «Εκκρεμότητες» panel of /assistant: the AI's proposed writes waiting for
// a human (pending, or in conflict with a later edit), plus the recent
// decisions. The same cards also appear inline in the chat.
export async function PendingChanges() {
  const supabase = await createClient();
  const orgId = await getCurrentOrgId(supabase);
  const [{ data: changes }, { data: history }] = await Promise.all([
    supabase
      .from("agent_changes")
      .select(CHANGE_COLUMNS)
      .eq("org_id", orgId)
      .in("status", ["pending", "conflict"])
      .order("created_at", { ascending: false }),
    supabase
      .from("agent_changes")
      .select("id, table_name, action, operation, status, reviewed_by, reviewed_at")
      .eq("org_id", orgId)
      .in("status", ["approved", "rejected", "failed"])
      .order("reviewed_at", { ascending: false })
      .limit(20),
  ]);

  const reviewerIds = [...new Set((history ?? []).map((h) => h.reviewed_by).filter((id): id is string => !!id))];
  const { data: reviewers } = reviewerIds.length
    ? await supabase.from("profiles").select("user_id, display_name, email").in("user_id", reviewerIds)
    : { data: [] };
  const reviewerName = (id: string | null) => {
    const p = reviewers?.find((r) => r.user_id === id);
    return p?.display_name || p?.email || "—";
  };

  return (
    <section id="changes" className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <AiSpark className="text-ai-ink" />
        <h2 className="text-base font-semibold">{el.nav.changes}</h2>
      </div>
      <p className="text-sm text-ink-muted">
        Προτάσεις αλλαγών από το Kansha Operator. Καμία δεν έχει εφαρμοστεί ακόμα -- ελέγξτε το πριν/μετά και
        εγκρίνετε ή απορρίψτε.
      </p>

      {(changes ?? []).length === 0 ? (
        <p className="text-sm text-ink-faint">Καμία εκκρεμής πρόταση αυτή τη στιγμή.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {(changes ?? []).map((c) => (
            <ChangeCardView key={c.id} initial={toChangeCard(c)} canReview />
          ))}
        </div>
      )}

      {history && history.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-medium text-ink-muted">Ιστορικό Αποφάσεων</h2>
          <div className="overflow-x-auto rounded-lg border border-line">
            <table className="w-full text-left text-xs">
              <thead className="bg-bg text-ink-muted">
                <tr>
                  <th className="p-1.5">Πίνακας</th>
                  <th className="p-1.5">Ενέργεια</th>
                  <th className="p-1.5">Απόφαση</th>
                  <th className="p-1.5">Από</th>
                  <th className="p-1.5">Πότε</th>
                </tr>
              </thead>
              <tbody>
                {history.map((h) => (
                  <tr key={h.id} className="border-t border-line">
                    <td className="p-1.5">{tableLabel(h.table_name, h.action)}</td>
                    <td className="p-1.5">{OP_LABEL[h.operation as ChangeOperation] ?? h.operation}</td>
                    <td className="p-1.5">
                      <Badge tone={h.status === "approved" ? "green" : "red"}>
                        {STATUS_LABEL[h.status as ChangeStatus] ?? h.status}
                      </Badge>
                    </td>
                    <td className="p-1.5">{reviewerName(h.reviewed_by)}</td>
                    <td className="p-1.5 text-ink-faint">{h.reviewed_at ? formatDate(h.reviewed_at) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </section>
  );
}
