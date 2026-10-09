import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

// Next.js 16 renamed the middleware convention to "proxy" -- this file (not
// middleware.ts) is what the framework actually invokes.
export async function proxy(request: NextRequest) {
  return updateSession(request);
}

// Static assets skip the proxy entirely. excalidraw-assets (self-hosted
// canvas fonts) must: otherwise the partner gate, which lets partners reach
// only /collab/**, would redirect a partner's font requests away.
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|excalidraw-assets/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|woff2?)$).*)",
  ],
};
