import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "@/lib/db/types";

// Request-scoped client carrying the user's JWT, so RLS enforces org
// membership in the database itself -- authorization is never only a
// property of application code. Used by every server component/action and
// by the AI assistant's read-only query tools.
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Called from a Server Component with no response to write to;
            // safe to ignore as long as middleware.ts refreshes the session.
          }
        },
      },
    },
  );
}
