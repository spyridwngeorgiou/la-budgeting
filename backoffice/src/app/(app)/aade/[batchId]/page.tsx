import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Badge, Button } from "@/components/ui";
import { ReviewTable } from "./ReviewTable";
import { commitBatch } from "../actions";

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
          "id, row_no, issue_date, counterparty_name, counterparty_afm, gross_amount, direction, dedup_status, decision, project_id, category_id, account_id, matched_transaction_id",
        )
        .eq("batch_id", batchId)
        .order("row_no"),
      supabase.from("projects").select("id, display_name").order("sort_order"),
      supabase.from("categories").select("id, name").order("sort_order"),
      supabase.from("accounts").select("id, name").order("sort_order"),
    ]);

  if (!batch) notFound();

  const newCount = (rows ?? []).filter((r) => r.dedup_status === "new").length;
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
          <form action={commitBatch.bind(null, batchId)}>
            <Button type="submit">Οριστικοποίηση Εισαγωγής</Button>
          </form>
        )}
      </div>

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
