import { createClient } from "@/lib/supabase/server";
import { getCurrentOrgId } from "@/lib/supabase/org";
import { formatDate } from "@/lib/format";
import { AiSpark, EmptyState, ReportHistory, SectionHeader, SpecTable, StatusDot, Td, Th, Tr, cn } from "@/components/ui";
import { OP_LABEL, STATUS_LABEL, tableLabel, toChangeCard, type ChangeOperation, type ChangeStatus } from "@/lib/ai/changeCards";
import { el } from "@/lib/i18n/el";
import { PendingList } from "./PendingList";

export const CHANGE_COLUMNS =
  "id, status, operation, table_name, action, reason, before, after, changed_fields, conflict, untrusted_context, error, result, created_at";

const HISTORY_TONE = { approved: "positive", rejected: "neutral", failed: "negative" } as const;

// «Εκκρεμότητες» panel of /assistant: the AI's proposed writes waiting for
// a human (pending, or in conflict with a later edit), plus the recent
// decisions behind «▸ Ιστορικό αποφάσεων». From 1280px it is a column right
// of the chat with the cards themselves; below that a compact list above
// the chat, each card opening in a drawer (PendingList). The same cards also
// appear inline in the chat.
export async function PendingChanges({ className = "" }: { className?: string }) {
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
  const cards = (changes ?? []).map(toChangeCard);
  const a = el.assistant;

  return (
    <section id="changes" aria-labelledby="changes-title" className={cn("flex min-w-0 flex-col gap-3", className)}>
      <SectionHeader
        title={
          <span id="changes-title" className="inline-flex items-center gap-2">
            <AiSpark className="text-ai" />
            {el.nav.pending} <span className="num text-body text-muted">{cards.length}</span>
          </span>
        }
      />
      {cards.length === 0 ? (
        <EmptyState title={a.noPending} className="py-4" />
      ) : (
        <>
          <p className="hidden text-small text-muted xl:block">{a.pendingHint}</p>
          <PendingList cards={cards} />
        </>
      )}

      {history && history.length > 0 && (
        <ReportHistory title={a.history} count={history.length} level={3} open={cards.length === 0}>
          <SpecTable label={a.history} tableClassName="text-small">
            <thead>
              <tr>
                <Th>Πίνακας</Th>
                <Th>Ενέργεια</Th>
                <Th>Απόφαση</Th>
                <Th>Από</Th>
                <Th>Πότε</Th>
              </tr>
            </thead>
            <tbody>
              {history.map((h) => (
                <Tr key={h.id}>
                  <Td>{tableLabel(h.table_name, h.action)}</Td>
                  <Td>{OP_LABEL[h.operation as ChangeOperation] ?? h.operation}</Td>
                  <Td>
                    <StatusDot
                      tone={HISTORY_TONE[h.status as keyof typeof HISTORY_TONE] ?? "neutral"}
                      label={STATUS_LABEL[h.status as ChangeStatus] ?? h.status}
                    />
                  </Td>
                  <Td>{reviewerName(h.reviewed_by)}</Td>
                  <Td className="num text-muted">{h.reviewed_at ? formatDate(h.reviewed_at) : "—"}</Td>
                </Tr>
              ))}
            </tbody>
          </SpecTable>
        </ReportHistory>
      )}
    </section>
  );
}
