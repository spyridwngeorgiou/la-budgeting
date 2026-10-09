import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getAccessContext } from "@/lib/supabase/access";
import { el } from "@/lib/i18n/el";
import { signOut } from "./actions";

// The collaboration space's own shell, shared by staff and external
// partners -- deliberately not the (app) Nav, so there is not a single
// finance link in it. Staff get one way back to the Back Office.
export default async function CollabLayout({ children }: { children: React.ReactNode }) {
  const access = await getAccessContext();
  if (access.kind === "anonymous") redirect("/login");

  return (
    <div className="flex min-h-dvh flex-col bg-bg">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-line bg-surface px-3 md:px-4">
        <Link href="/collab" className="shrink-0">
          <Image
            src="/kansha-logo.png"
            alt="Kansha"
            width={120}
            height={44}
            style={{ width: "88px", height: "auto" }}
            priority
          />
        </Link>
        <nav className="flex min-w-0 flex-1 items-center gap-1 text-sm">
          <Link href="/collab" className="rounded-md px-2 py-1.5 text-ink-muted hover:bg-bg hover:text-ink">
            {el.collab.myProjects}
          </Link>
          {access.kind === "internal" && (
            <Link href="/dashboard" className="rounded-md px-2 py-1.5 text-ink-muted hover:bg-bg hover:text-ink">
              {el.collab.backToApp}
            </Link>
          )}
        </nav>
        <span className="hidden truncate text-xs text-ink-faint sm:inline">{access.email}</span>
        <form action={signOut}>
          <button type="submit" className="rounded-md px-2 py-1.5 text-xs text-ink-muted hover:bg-bg hover:text-ink">
            {el.collab.signOut}
          </button>
        </form>
      </header>
      <main className="flex min-h-0 flex-1 flex-col">{children}</main>
    </div>
  );
}
