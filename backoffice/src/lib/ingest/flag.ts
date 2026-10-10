// INGEST_UNIFIED (wrangler.jsonc vars, "false" in both environments until
// cutover): when "true", /documents/new, /aade and the email webhook stage
// ingest batches and /inbox/[batchId] is the only review screen; the old
// transaction_drafts / aade_* paths are left untouched otherwise. Read at
// request time on the server, never inlined into the client bundle.
export function ingestUnified(): boolean {
  return process.env.INGEST_UNIFIED === "true";
}
