// Pure path rules shared by the proxy (edge) and route handlers -- no
// Supabase or next/headers imports, so the proxy can use them and vitest
// can test them directly.

// Paths an external partner may reach at all. Everything else is a finance
// surface: pages redirect to /collab, API routes answer 403. RLS already
// returns a partner nothing there; this keeps them from rendering an empty
// finance UI or spending the org's AI budget on finance routes.
export function isPartnerAllowedPath(pathname: string): boolean {
  return (
    pathname === "/collab" ||
    pathname.startsWith("/collab/") ||
    pathname.startsWith("/auth/") ||
    pathname.startsWith("/api/collab/") ||
    pathname === "/login"
  );
}

// `next` after an email link is attacker-controllable (anyone can mail a
// victim a real Supabase link with a crafted ?next=). Only same-origin
// relative paths survive: "//evil.com" and "/\evil.com" are protocol-
// relative in browsers, and anything with a scheme is absolute.
export function safeNextPath(next: string | null | undefined, fallback = "/"): string {
  if (!next) return fallback;
  if (!next.startsWith("/")) return fallback;
  if (next.startsWith("//") || next.startsWith("/\\")) return fallback;
  if (/[\u0000-\u001f]/.test(next)) return fallback;
  return next;
}

// Supabase Storage object path for a collab file. collab_path_ok() (0038)
// accepts exactly four segments: three uuids and a safe file name.
export function collabStoragePath(orgId: string, projectId: string, boardId: string, fileName: string): string {
  const safe = fileName.replace(/[^A-Za-z0-9._-]/g, "_").replace(/\.{2,}/g, "_").slice(-160) || "file";
  return `${orgId}/${projectId}/${boardId}/${safe}`;
}

// Realtime private-channel topic. Must match realtime_board_topic_ok().
export function boardTopic(boardId: string): string {
  return `board:${boardId}`;
}
