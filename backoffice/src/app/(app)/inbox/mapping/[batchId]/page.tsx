import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { readBankGrid, UnsupportedFileError } from "@/lib/ingest/adapters/bankFile";
import { cellText, guessColumnMap, guessHeaderRow } from "@/lib/ingest/profiles/detect";
import { MappingForm } from "./MappingForm";

// Column-mapping wizard for a statement no profile recognised: preview the
// first rows, propose header row + columns, let the user correct them, and
// save the result as the org's own profile (actions.saveMappingAndStage).
export default async function MappingPage({ params }: { params: Promise<{ batchId: string }> }) {
  const { batchId } = await params;
  const supabase = await createClient();
  const { data: batch } = await supabase
    .from("ingest_batches")
    .select("id, filename, storage_path, status, row_count")
    .eq("id", batchId)
    .maybeSingle();
  if (!batch?.storage_path) notFound();
  if (batch.row_count > 0 || batch.status !== "staged") redirect(`/inbox/${batchId}`);

  const { data: blob } = await supabase.storage.from("bank-statements").download(batch.storage_path);
  if (!blob) notFound();
  let grid;
  try {
    ({ grid } = await readBankGrid({ name: batch.filename ?? "", mimeType: "", bytes: new Uint8Array(await blob.arrayBuffer()) }));
  } catch (e) {
    if (e instanceof UnsupportedFileError) return <p className="text-sm text-red-ink">{e.message}</p>;
    throw e;
  }

  const headerRow = guessHeaderRow(grid) ?? 0;
  const preview = grid.slice(0, 25).map((row) => row.map(cellText));
  const width = Math.max(1, ...preview.map((r) => r.length));

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold">Αντιστοίχιση στηλών</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Η μορφή του «{batch.filename}» δεν αναγνωρίστηκε. Δείξτε ποια γραμμή είναι η επικεφαλίδα και τι περιέχει κάθε
          στήλη — η αντιστοίχιση αποθηκεύεται και το επόμενο αρχείο της ίδιας τράπεζας αναγνωρίζεται αυτόματα.
        </p>
      </div>
      <MappingForm
        batchId={batchId}
        preview={preview}
        width={width}
        initialHeaderRow={headerRow + 1}
        initialColumns={guessColumnMap(grid[headerRow] ?? []) as Record<string, number>}
        defaultName={batch.filename ?? ""}
      />
    </div>
  );
}
