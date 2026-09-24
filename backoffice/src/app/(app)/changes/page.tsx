import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/format";
import { Badge, Card, Button, AiSpark } from "@/components/ui";
import { ALLOWLIST, type WritableTable } from "@/lib/ai/writeTools";
import { approveChange, rejectChange } from "./actions";

const OP_LABEL: Record<string, string> = {
  insert: "Νέα εγγραφή",
  update: "Ενημέρωση",
  delete: "Διαγραφή",
};

export default async function ChangesPage() {
  const supabase = await createClient();
  const [{ data: changes }, { data: history }] = await Promise.all([
    supabase.from("agent_changes").select("*").eq("status", "pending").order("created_at", { ascending: false }),
    // Audit trail: reviewed_by/reviewed_at already existed in the schema but
    // were never surfaced anywhere -- once a change was approved/rejected it
    // simply vanished, with no way to answer "who approved this and when".
    supabase
      .from("agent_changes")
      .select("id, table_name, operation, status, reviewed_by, reviewed_at")
      .in("status", ["approved", "rejected"])
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
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <AiSpark className="text-ai-ink" />
        <h1 className="text-xl font-semibold">Εκκρεμείς Αλλαγές AI</h1>
      </div>
      <p className="text-sm text-ink-muted">
        Προτάσεις αλλαγών από το Kansha Operator σε λογαριασμούς, έργα, επαφές και πλάνα δόσεων.
        Καμία δεν έχει εφαρμοστεί ακόμα -- ελέγξτε το πριν/μετά και εγκρίνετε ή απορρίψτε.
      </p>

      {(changes ?? []).length === 0 ? (
        <p className="text-sm text-ink-faint">Καμία εκκρεμής πρόταση αυτή τη στιγμή.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {(changes ?? []).map((c) => {
            const spec = ALLOWLIST[c.table_name as WritableTable];
            const before = (c.before as Record<string, unknown> | null) ?? {};
            const after = (c.after as Record<string, unknown>) ?? {};
            const fields =
              c.operation === "delete"
                ? Object.keys(before)
                : c.operation === "insert"
                  ? Object.keys(after)
                  : [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(
                      (k) => spec?.editableFields.includes(k) && before[k] !== after[k],
                    );

            return (
              <Card key={c.id} className="border-ai-border">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <Badge tone={c.operation === "delete" ? "red" : "ai"}>
                    {OP_LABEL[c.operation] ?? c.operation}
                  </Badge>
                  <span className="text-sm font-medium">{spec?.label ?? c.table_name}</span>
                  <span className="text-xs text-ink-faint">{formatDate(c.created_at)}</span>
                </div>

                {c.reason && <p className="mb-2 text-sm text-ink-muted">{c.reason}</p>}

                <div className="mb-3 overflow-x-auto rounded border border-line">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-bg text-ink-muted">
                      <tr>
                        <th className="p-1.5">Πεδίο</th>
                        {c.operation !== "insert" && <th className="p-1.5">Πριν</th>}
                        {c.operation !== "delete" && <th className="p-1.5">Μετά</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {fields.length === 0 ? (
                        <tr>
                          <td className="p-1.5 text-ink-faint" colSpan={3}>
                            Καμία διαφορά σε επιτρεπτά πεδία.
                          </td>
                        </tr>
                      ) : (
                        fields.map((f) => (
                          <tr key={f} className="border-t border-line">
                            <td className="p-1.5 font-medium">{f}</td>
                            {c.operation !== "insert" && (
                              <td className="p-1.5 font-mono text-red-ink">{String(before[f] ?? "—")}</td>
                            )}
                            {c.operation !== "delete" && (
                              <td className="p-1.5 font-mono text-sage-ink">{String(after[f] ?? "—")}</td>
                            )}
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>

                <div className="flex justify-end gap-2">
                  <form action={rejectChange.bind(null, c.id)}>
                    <Button type="submit" variant="secondary">
                      Απόρριψη
                    </Button>
                  </form>
                  <form action={approveChange.bind(null, c.id)}>
                    <Button type="submit" variant={c.operation === "delete" ? "danger" : "primary"}>
                      Έγκριση
                    </Button>
                  </form>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {history && history.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-medium text-ink-muted">Ιστορικό Αποφάσεων</h2>
          <div className="overflow-x-auto rounded border border-line">
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
                    <td className="p-1.5">{ALLOWLIST[h.table_name as WritableTable]?.label ?? h.table_name}</td>
                    <td className="p-1.5">{OP_LABEL[h.operation] ?? h.operation}</td>
                    <td className="p-1.5">
                      <Badge tone={h.status === "approved" ? "green" : "red"}>
                        {h.status === "approved" ? "Εγκρίθηκε" : "Απορρίφθηκε"}
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
    </div>
  );
}
