"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { Bell, Search, Sparkles } from "lucide-react";
import { Brand } from "@/components/ui/Brand";
import { cn } from "@/components/ui/cn";
import { Menu, MenuLink, MenuSeparator } from "@/components/ui/Menu";
import { activeDestination, ASK_V2, navForRole, SETTINGS_V2, type ShellRole } from "@/lib/navigation";
import { shell } from "@/lib/i18n/v2/shell";
import { setUiVersion } from "@/lib/ui/actions";
import { signOut } from "@/app/(collab)/actions";

// The top bar. Left: the running head («ORG · Προορισμός», like the P15
// page heads). Middle: «Ρώτα», a plain GET form into the assistant for now
// (Phase 5 makes it a drawer); Ctrl/⌘ K focuses it. Right: on phones 🔔
// Εκκρεμότητες and ✦ Ρώτα (the bottom bar has no room for them), then the
// user menu with «Κλασική εμφάνιση» and sign out.
export function TopBar({
  role,
  orgName,
  email,
  pendingCount,
}: {
  role: ShellRole;
  orgName: string | null;
  email: string | null;
  pendingCount: number;
}) {
  const pathname = usePathname() ?? "";
  const items = navForRole(role);
  const here =
    activeDestination(items, pathname)?.label ??
    (pathname.startsWith(SETTINGS_V2.href) ? SETTINGS_V2.label : null);
  const askHref = role === "partner" ? ASK_V2.partnerHref : ASK_V2.href;
  const inbox = items.find((d) => d.key === "inbox");
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        input.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const initials = (email ?? "?").slice(0, 1).toUpperCase();

  return (
    <header className="sticky top-0 z-20 flex h-topbar shrink-0 items-center gap-3 border-b border-hairline bg-canvas px-4 md:px-8">
      <Link href={items[0]?.href ?? "/"} className="text-navy md:hidden" aria-label="Kansha">
        <Brand compact />
      </Link>

      <p className="eyebrow min-w-0 flex-1 truncate text-muted" aria-label={shell.topbar.breadcrumb}>
        {orgName && <span className="hidden sm:inline">{orgName}</span>}
        {orgName && here && (
          <span aria-hidden="true" className="hidden sm:inline">
            {" · "}
          </span>
        )}
        {here && <span className="text-ink">{here}</span>}
      </p>

      {role !== "partner" && (
        <form action={askHref} method="get" role="search" className="relative hidden w-full max-w-sm md:block">
          <label htmlFor="topbar-ask" className="sr-only">
            {shell.nav.ask}
          </label>
          <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted" />
          <input
            ref={input}
            id="topbar-ask"
            name="q"
            type="search"
            autoComplete="off"
            placeholder={shell.topbar.askPlaceholder}
            className="min-h-9 w-full border border-field-border bg-field py-1.5 pr-16 pl-9 text-sm text-ink placeholder:text-muted focus:border-navy focus:outline-none"
          />
          <kbd className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 border border-hairline px-1.5 text-xs text-muted">
            {shell.topbar.askShortcut}
          </kbd>
        </form>
      )}

      {inbox && (
        <Link
          href={inbox.href}
          className="relative inline-flex h-10 w-10 items-center justify-center text-text hover:bg-hover md:hidden"
          aria-label={pendingCount > 0 ? `${inbox.label}: ${pendingCount} ${shell.nav.pending}` : inbox.label}
        >
          <Bell aria-hidden="true" className="h-5 w-5" strokeWidth={1.5} />
          {pendingCount > 0 && (
            <span aria-hidden="true" className="num absolute top-1 right-1 text-xs font-medium text-navy">
              {pendingCount}
            </span>
          )}
        </Link>
      )}
      <Link
        href={askHref}
        className={cn(
          "inline-flex h-10 w-10 items-center justify-center text-ai hover:bg-hover",
          // Staff have the search box from md up; partners keep the icon.
          role !== "partner" && "md:hidden",
        )}
        aria-label={shell.nav.ask}
      >
        <Sparkles aria-hidden="true" className="h-5 w-5" strokeWidth={1.5} />
      </Link>

      <Menu
        label={shell.topbar.userMenu}
        trigger={
          <span
            aria-hidden="true"
            className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-frame text-xs font-medium text-ink"
          >
            {initials}
          </span>
        }
      >
        {email && <p className="truncate px-3 py-2 text-small text-muted">{email}</p>}
        {role !== "partner" && <MenuLink href={SETTINGS_V2.href}>{SETTINGS_V2.label}</MenuLink>}
        <form action={setUiVersion}>
          <input type="hidden" name="version" value="v1" />
          <button type="submit" role="menuitem" className="flex min-h-10 w-full items-center px-3 py-2 text-left text-sm text-ink hover:bg-hover">
            {shell.topbar.classicLook}
          </button>
        </form>
        <MenuSeparator />
        <form action={signOut}>
          <button type="submit" role="menuitem" className="flex min-h-10 w-full items-center px-3 py-2 text-left text-sm text-ink hover:bg-hover">
            {shell.topbar.signOut}
          </button>
        </form>
      </Menu>
    </header>
  );
}
