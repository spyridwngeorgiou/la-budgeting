import Link from "next/link";
import { Brand, Button } from "@/components/ui";
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
    <div className="flex min-h-dvh flex-col bg-canvas text-ink">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-hairline bg-raised px-3 md:gap-4 md:px-6">
        <Link href="/collab" className="inline-flex min-h-11 shrink-0 items-center pr-2">
          <Brand compact className="sm:hidden" />
          <Brand className="max-sm:hidden" />
        </Link>
        <nav className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto text-sm">
          <Link
            href="/collab"
            className="inline-flex min-h-11 items-center px-2.5 whitespace-nowrap text-text hover:bg-hover hover:text-ink"
          >
            {el.collab.myProjects}
          </Link>
          {access.kind === "internal" && (
            <Link
              href="/dashboard"
              className="inline-flex min-h-11 items-center px-2.5 whitespace-nowrap text-text hover:bg-hover hover:text-ink"
            >
              {el.collab.backToApp}
            </Link>
          )}
        </nav>
        <span className="hidden truncate text-small text-muted md:inline">{access.email}</span>
        <form action={signOut}>
          <Button type="submit" variant="ghost" size="sm" className="max-md:min-h-11">
            {el.collab.signOut}
          </Button>
        </form>
      </header>
      <main className="flex min-h-0 flex-1 flex-col">{children}</main>
    </div>
  );
}
