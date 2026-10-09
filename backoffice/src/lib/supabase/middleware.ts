import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "@/lib/db/types";
import { isPartnerAllowedPath } from "@/lib/collab/paths";

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // getUser() may have just rotated the session; a fresh redirect/JSON
  // response would drop those Set-Cookie headers and leave the browser on a
  // spent refresh token. Carry them over.
  const keepSessionCookies = (res: NextResponse) => {
    response.cookies.getAll().forEach((c) => res.cookies.set(c));
    return res;
  };

  const pathname = request.nextUrl.pathname;
  const isAuthRoute = pathname.startsWith("/login");
  // /auth/confirm is where emailed magic/invite links land -- by definition
  // the visitor has no session yet.
  const isAuthCallback = pathname.startsWith("/auth/");
  // API routes handle their own auth (or, like /api/health, are meant to be
  // hit anonymously by the keepalive cron) and should return a JSON error,
  // not an HTML redirect to /login.
  const isApiRoute = pathname.startsWith("/api/");

  if (!user && !isAuthRoute && !isAuthCallback && !isApiRoute) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  // External partners (0037) have no org membership. Gate them here, before
  // any finance page renders or any finance API route runs. Paths partners
  // may use skip the lookup entirely, so the collab space pays nothing; for
  // internal users this is one indexed EXISTS per navigation.
  if (user && !isPartnerAllowedPath(pathname)) {
    const { data: isInternal, error } = await supabase.rpc("is_internal_user");
    // Fail closed: if the check itself errors, treat as not internal.
    if (error || !isInternal) {
      if (isApiRoute) {
        return keepSessionCookies(NextResponse.json({ error: "Δεν επιτρέπεται." }, { status: 403 }));
      }
      const url = request.nextUrl.clone();
      url.pathname = "/collab";
      url.search = "";
      return keepSessionCookies(NextResponse.redirect(url));
    }
  }

  if (user && isAuthRoute) {
    const url = request.nextUrl.clone();
    // "/" leads to the dashboard for staff; the partner gate above sends a
    // partner's next request on to /collab instead.
    url.pathname = "/";
    url.search = "";
    return keepSessionCookies(NextResponse.redirect(url));
  }

  return response;
}
