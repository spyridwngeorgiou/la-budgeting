import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { safeNextPath } from "@/lib/collab/paths";

const OTP_TYPES: readonly EmailOtpType[] = ["email", "magiclink", "invite", "signup", "recovery", "email_change"];

// Landing point for every emailed link (partner invites, magic-link sign
// in). The email templates point here with ?token_hash=...&type=... (see
// README / Supabase dashboard config) instead of Supabase's own /verify
// redirect, so the session is established server-side via verifyOtp and
// works on whichever device opens the mail -- no PKCE code verifier in
// the original browser needed.
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const tokenHash = searchParams.get("token_hash");
  const typeParam = searchParams.get("type");
  // Relative-only: never bounce a freshly signed-in user to another origin.
  const next = safeNextPath(searchParams.get("next"), "/");

  const type = OTP_TYPES.find((t) => t === typeParam);
  const code = searchParams.get("code");
  if ((tokenHash && type) || code) {
    const supabase = await createClient();
    const { error } =
      tokenHash && type
        ? await supabase.auth.verifyOtp({ type, token_hash: tokenHash })
        : // Fallback for templates still on {{ .ConfirmationURL }} (PKCE):
          // only works in the browser that requested the link.
          await supabase.auth.exchangeCodeForSession(code!);
    if (!error) {
      // "/" -> dashboard for staff; the proxy routes partners on to /collab.
      return NextResponse.redirect(new URL(next, request.nextUrl.origin));
    }
  }

  const failed = new URL("/login", request.nextUrl.origin);
  failed.searchParams.set("link", "invalid");
  return NextResponse.redirect(failed);
}
