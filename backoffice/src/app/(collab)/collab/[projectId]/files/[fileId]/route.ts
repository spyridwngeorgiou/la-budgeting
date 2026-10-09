import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { el } from "@/lib/i18n/el";

// Opens a collaboration file: access check, then a short-lived signed URL.
// Both steps run under the caller's own RLS session -- board_files_select
// (can_access_project) decides whether the row is visible at all, and the
// `collab` bucket's own policy (collab_path_ok) must agree before Storage
// will sign. A guessed id from another project is simply a 404.
//
// Links on boards and in the chat outlive deleted files (0060), so the 404
// is a small readable page rather than JSON.
function notFoundPage() {
  const html = `<!doctype html><html lang="el"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${el.collab.fileLibrary.removed}</title></head><body style="font-family:system-ui,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;background:#f0f2f2;color:#16181a"><p style="font-size:18px">🗑️ ${el.collab.fileLibrary.removed}</p></body></html>`;
  return new NextResponse(html, {
    status: 404,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "private, no-store" },
  });
}

export async function GET(_request: NextRequest, ctx: { params: Promise<{ projectId: string; fileId: string }> }) {
  const { projectId, fileId } = await ctx.params;
  const supabase = await createClient();

  const { data: file } = await supabase
    .from("board_files")
    .select("storage_path")
    .eq("id", fileId)
    .eq("project_id", projectId)
    .maybeSingle();
  if (!file) return notFoundPage();

  // Inline (no `download`): PDFs and images open in the browser's viewer.
  const { data: signed, error } = await supabase.storage.from("collab").createSignedUrl(file.storage_path, 60);
  if (error || !signed) return notFoundPage();

  return NextResponse.redirect(signed.signedUrl, { headers: { "Cache-Control": "private, no-store" } });
}
