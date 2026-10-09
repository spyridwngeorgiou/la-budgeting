import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Opens a collaboration file: access check, then a short-lived signed URL.
// Both steps run under the caller's own RLS session -- board_files_select
// (can_access_project) decides whether the row is visible at all, and the
// `collab` bucket's own policy (collab_path_ok) must agree before Storage
// will sign. A guessed id from another project is simply a 404.
export async function GET(_request: NextRequest, ctx: { params: Promise<{ projectId: string; fileId: string }> }) {
  const { projectId, fileId } = await ctx.params;
  const supabase = await createClient();

  const { data: file } = await supabase
    .from("board_files")
    .select("storage_path")
    .eq("id", fileId)
    .eq("project_id", projectId)
    .maybeSingle();
  if (!file) return NextResponse.json({ error: "Δεν βρέθηκε." }, { status: 404 });

  // Inline (no `download`): PDFs and images open in the browser's viewer.
  const { data: signed, error } = await supabase.storage.from("collab").createSignedUrl(file.storage_path, 60);
  if (error || !signed) return NextResponse.json({ error: "Δεν βρέθηκε." }, { status: 404 });

  return NextResponse.redirect(signed.signedUrl, { headers: { "Cache-Control": "private, no-store" } });
}
