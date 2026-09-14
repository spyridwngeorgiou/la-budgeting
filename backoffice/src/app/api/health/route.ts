import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Hit by a scheduled GitHub Actions workflow every 3 days so the Supabase
// free-tier project (paused after 7 idle days) never actually goes idle.
export async function GET() {
  const supabase = await createClient();
  const { error } = await supabase.from("orgs").select("id").limit(1);

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
