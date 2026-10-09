import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Badge, Button } from "@/components/ui";
import { ReviewTable } from "./ReviewTable";
import { commitBatch } from "../actions";
import { el } from "@/lib/i18n/el";
import { ActionForm } from "@/components/ActionForm";

export default async function AadeBatchReviewPage({
  params,
}: {
  params: Promise<{ batchId: string }>;
}) {
  const { batchId } = await params;
  const supabase = await createClient();

  const [{ data: batch }, { data: rows }, { data: projects }, { data: categories }, { data: accounts }] =
    await Promise.all([
      supabase.from("aade_import_batches").select("*").eq("id", batchId).maybeSingle(),
      supabase
        .from("aade_staging_rows")
        .select(
          "id, row_no, issue_date, counterparty_name, counterparty_afm, gross_amount, direction, dedup_status, decision, project_id, category_id, account_id, matched_transaction_id, committed_transaction_id, commit_error",
        )
        .eq("batch_id", batchId)
        .order("row_no"),
      supabase.from("projects").select("id, display_name").order("sort_order"),
      supabase.from("categories").select("id, name").order("sort_order"),
      supabase.from("accounts").select("id, name").order("sort_order"),
    ]);

  if (!batch) notFound();

  const newCount = (rows ?? []).filter((r) => r.dedup_status === "new").length;
  // Set by commitBatch when a row could not be written; cleared once it is.
  const failedRows = (rows ?? []).filter((r) => r.commit_error && !r.committed_transaction_id);
  const dupCount = (rows?.length ?? 0) - newCount;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">{batch.filename}</h1>
          <p className="text-sm text-ink-muted">
            {rows?.length ?? 0} γραμμές · {newCount} νέες · {dupCount} διπλότυπες
          </p>
        </div>
        {batch.status === "committed" ? (
          <Badge tone="green">Ολοκληρώθηκε</Badge>
        ) : (
          <ActionForm action={commitBatch.bind(null, batchId)}>
            <Button type="submit">Οριστικοποίηση Εισαγωγής</Button>
          </ActionForm>
        )}
      </div>

      {failedRows.length > 0 && (
        <div role="alert" className="rounded-lg border border-red-ink/40 bg-red-bg p-3 text-sm text-red-ink">
          <p className="font-semibold">
            {failedRows.length} {el.ingest.commitFailedRows}
          </p>
          <ul className="mt-1 list-disc pl-5">
            {failedRows.map((r) => (
              <li key={r.id}>
                {el.ingest.row} {r.row_no}
                {r.counterparty_name ? ` (${r.counterparty_name})` : ""}: {r.commit_error}
              </li>
            ))}
          </ul>
        </div>
      )}

      <ReviewTable
        batchId={batchId}
        rows={rows ?? []}
        projects={(projects ?? []).map((p) => ({ id: p.id, label: p.display_name }))}
        categories={(categories ?? []).map((c) => ({ id: c.id, label: c.name }))}
        accounts={(accounts ?? []).map((a) => ({ id: a.id, label: a.name }))}
      />
    </div>
  );
}
