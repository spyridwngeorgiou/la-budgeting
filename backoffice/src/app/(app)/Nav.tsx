"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Plus } from "lucide-react";
import { el } from "@/lib/i18n/el";
import { AiSpark, Badge, Brand, buttonClass, withPlus } from "@/components/ui";
import { OrgSwitcher } from "./OrgSwitcher";
import type { OrgRole } from "@/lib/domain/enums";

const ROLE_RANK: Record<OrgRole, number> = { viewer: 0, editor: 1, admin: 2, owner: 3 };

type NavItem = { href: string; label: string; ai?: boolean; minRole?: OrgRole; also?: string[]; badge?: "inbox" };

// The sections, in groups split by a hairline (no titles), Ρυθμίσεις pinned
// at the bottom. Sub-pages live as tabs inside each (src/lib/navigation.ts).
// minRole hides a section whose every action the role couldn't take anyway
// (RLS would refuse the writes). `also` lists other paths that belong to a
// section (old upload screens still open from links). The collaboration
// space is entered from each project page; partners keep /collab.
const NAV_GROUPS: NavItem[][] = [
  [
    { href: "/dashboard", label: el.nav.dashboard },
    { href: "/inbox", label: el.nav.inbox, minRole: "editor", also: ["/documents", "/aade"], badge: "inbox" },
    { href: "/assistant", label: el.nav.assistant, ai: true },
  ],
  [
    { href: "/transactions", label: el.nav.transactions },
    { href: "/accounts", label: el.nav.accounts },
    { href: "/reports", label: el.nav.reports },
  ],
  [
    { href: "/projects", label: el.nav.projects },
    { href: "/planner", label: el.nav.planner },
    { href: "/calendar", label: el.nav.calendar },
  ],
  [{ href: "/contacts", label: el.nav.contacts }],
];
const SETTINGS: NavItem = { href: "/settings", label: el.nav.settings };
const CAPTURE_HREF = "/inbox/new";

const owns = (prefix: string, pathname: string) => pathname === prefix || pathname.startsWith(prefix + "/");

function NavLink({ item, path, inboxCount }: { item: NavItem; path: string; inboxCount: number }) {
  // /inbox/new is the «＋ Καταχώριση» button's, not the inbox item's.
  const active = path !== CAPTURE_HREF && (owns(item.href, path) || (item.also ?? []).some((p) => owns(p, path)));
  const badge = item.badge === "inbox" && inboxCount > 0 ? inboxCount : null;
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={`flex min-h-11 items-center gap-1.5 border-b-2 px-3 whitespace-nowrap transition-colors md:border-b-0 md:border-l-2 md:px-4 ${
        active
          ? item.ai
            ? "border-ai bg-ai-tint text-ai"
            : "border-navy bg-hover text-ink"
          : item.ai
            ? "border-transparent text-ai hover:bg-ai-tint"
            : "border-transparent text-muted hover:bg-hover hover:text-ink"
      }`}
    >
      {item.ai && <AiSpark />}
      {item.label}
      {badge !== null && (
        <span className="ml-auto" aria-label={`${badge} ${el.nav.pending}`}>
          <Badge className="num text-ink">{badge}</Badge>
        </span>
      )}
    </Link>
  );
}

export function Nav({
  children,
  orgs,
  currentOrgId,
  role,
  inboxCount = 0,
}: {
  children: React.ReactNode;
  orgs: { id: string; name: string }[];
  currentOrgId: string;
  role: OrgRole;
  inboxCount?: number;
}) {
  const path = usePathname() ?? "";
  const allowed = (item: NavItem) => !item.minRole || ROLE_RANK[role] >= ROLE_RANK[item.minRole];
  const groups = NAV_GROUPS.map((group) => group.filter(allowed)).filter((group) => group.length > 0);
  const canCapture = ROLE_RANK[role] >= ROLE_RANK.editor;
  const capturing = path === CAPTURE_HREF;

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <nav className="min-w-0 border-b border-hairline bg-canvas md:sticky md:top-0 md:flex md:h-screen md:w-rail md:shrink-0 md:flex-col md:overflow-y-auto md:border-b-0 md:border-r">
        <Link href="/" aria-label="Kansha" className="flex min-h-11 items-center px-4 pt-5 pb-3">
          <Brand />
        </Link>
        <OrgSwitcher orgs={orgs} currentOrgId={currentOrgId} />
        {canCapture && (
          <div className="hidden px-4 pt-2 pb-1 md:block">
            <Link href={CAPTURE_HREF} aria-current={capturing ? "page" : undefined} className={buttonClass("primary", "md", "w-full")}>
              {withPlus(`+ ${el.nav.capture}`)}
            </Link>
          </div>
        )}
        <ul className="flex overflow-x-auto px-2 text-body md:flex-1 md:flex-col md:gap-px md:overflow-visible md:px-0 md:py-2">
          {groups.map((group, g) =>
            group.map((item, i) => (
              <li
                key={item.href}
                className={`shrink-0 ${g > 0 && i === 0 ? "ml-2 border-l border-hairline pl-2 md:mt-2 md:ml-0 md:border-t md:border-l-0 md:pt-2 md:pl-0" : ""}`}
              >
                <NavLink item={item} path={path} inboxCount={inboxCount} />
              </li>
            )),
          )}
          <li className="ml-2 shrink-0 border-l border-hairline pl-2 md:mt-auto md:ml-0 md:border-t md:border-l-0 md:pt-2 md:pl-0">
            <NavLink item={SETTINGS} path={path} inboxCount={inboxCount} />
          </li>
        </ul>
      </nav>
      {/* One page width (max-w-page, centred) for every page; on phones the
          bottom keeps clear of the «＋» button and the home indicator. */}
      <main
        className={`min-w-0 flex-1 bg-canvas px-4 py-5 md:px-8 md:py-8 ${canCapture ? "max-md:pb-[calc(6rem+env(safe-area-inset-bottom))]" : ""}`}
      >
        <div className="mx-auto w-full max-w-page min-w-0">{children}</div>
      </main>
      {canCapture && !capturing && (
        <Link
          href={CAPTURE_HREF}
          aria-label={el.nav.capture}
          className="fixed right-4 bottom-[calc(1rem+env(safe-area-inset-bottom))] z-40 flex h-14 w-14 items-center justify-center border border-navy bg-navy text-panel-ink transition-colors hover:border-navy-strong hover:bg-navy-strong md:hidden"
        >
          <Plus className="h-6 w-6" strokeWidth={1.5} aria-hidden />
        </Link>
      )}
    </div>
  );
}
