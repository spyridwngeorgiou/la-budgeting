"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { el } from "@/lib/i18n/el";
import { AiSpark } from "@/components/ui";
import { OrgSwitcher } from "./OrgSwitcher";
import type { OrgRole } from "@/lib/domain/enums";

const ROLE_RANK: Record<OrgRole, number> = { viewer: 0, editor: 1, admin: 2, owner: 3 };

// The 11 sections. Sub-pages live as tabs inside each (see
// src/lib/navigation.ts). minRole hides a section whose every action the role
// couldn't take anyway (RLS would refuse the writes). `also` lists other
// paths that belong to a section (uploads now start from the inbox).
const NAV_ITEMS: { href: string; label: string; ai?: boolean; minRole?: OrgRole; also?: string[]; badge?: "pending" }[] = [
  { href: "/dashboard", label: el.nav.dashboard },
  { href: "/transactions", label: el.nav.transactions },
  { href: "/inbox", label: el.nav.inbox, minRole: "editor", also: ["/documents", "/aade"] },
  { href: "/projects", label: el.nav.projects },
  { href: "/planner", label: el.nav.planner },
  { href: "/reports", label: el.nav.reports },
  { href: "/contacts", label: el.nav.contacts },
  { href: "/accounts", label: el.nav.accounts },
  // Shared with external partners: leads out of the finance shell into (collab).
  { href: "/collab", label: el.collab.navLabel },
  { href: "/assistant", label: el.nav.assistant, ai: true, badge: "pending" },
  { href: "/settings", label: el.nav.settings },
];

const owns = (prefix: string, pathname: string) => pathname === prefix || pathname.startsWith(prefix + "/");

export function Nav({
  children,
  orgs,
  currentOrgId,
  role,
  pendingChanges = 0,
}: {
  children: React.ReactNode;
  orgs: { id: string; name: string }[];
  currentOrgId: string;
  role: OrgRole;
  pendingChanges?: number;
}) {
  const pathname = usePathname();
  const items = NAV_ITEMS.filter((item) => !item.minRole || ROLE_RANK[role] >= ROLE_RANK[item.minRole]);

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <nav className="min-w-0 border-b border-hairline bg-canvas md:sticky md:top-0 md:h-screen md:w-56 md:shrink-0 md:overflow-y-auto md:border-b-0 md:border-r">
        <Link href="/dashboard" className="block px-4 pt-5 pb-3">
          <Image
            src="/kansha-logo.png"
            alt="Kansha"
            width={120}
            height={44}
            style={{ width: "110px", height: "auto" }}
            priority
          />
        </Link>
        <OrgSwitcher orgs={orgs} currentOrgId={currentOrgId} />
        <ul className="flex overflow-x-auto px-2 text-sm md:flex-col md:gap-px md:overflow-visible md:px-0 md:py-2">
          {items.map((item) => {
            const path = pathname ?? "";
            const active = owns(item.href, path) || (item.also ?? []).some((p) => owns(p, path));
            const badge = item.badge === "pending" && pendingChanges > 0 ? pendingChanges : null;
            return (
              <li key={item.href} className="shrink-0">
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
                    <span
                      className="num ml-auto border border-ai-border px-1.5 text-[11px] leading-[18px] font-medium text-ai"
                      aria-label={`${badge} ${el.nav.pending}`}
                    >
                      {badge}
                    </span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      <main className="min-w-0 flex-1 bg-canvas px-4 py-5 md:px-8 md:py-8">{children}</main>
    </div>
  );
}
