"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { el } from "@/lib/i18n/el";
import { AiSpark } from "@/components/ui";
import { OrgSwitcher } from "./OrgSwitcher";
import type { OrgRole } from "@/lib/domain/enums";

const ROLE_RANK: Record<OrgRole, number> = { viewer: 0, editor: 1, admin: 2, owner: 3 };

// Ordered by actual importance/frequency of use, not demo effect or feature
// grouping: the screens opened daily to run the ledger lead (dashboard,
// transactions, projects, analysis, VAT, cashflow), then the reference/admin
// screens used regularly but not daily (contacts, accounts, installments),
// then planning tools used occasionally (revenue plans), then the AI
// accelerators for specific tasks, then settings last.
// revenue-plans dropped its `ai: true` tag -- only plan *creation* uses AI
// (natural-language input filling the occupancy/ADR grid); the page itself
// is otherwise plain deterministic math (room-type totals, actual-vs-plan
// comparison), same as every other page here. AI is an accelerator for one
// step, not a reason to badge the whole feature as "an AI thing".
// minRole hides entries whose every action the role couldn't take anyway
// (RLS would refuse the writes) -- a viewer has nothing to approve in
// «Εκκρεμείς Αλλαγές» and nothing to enter through the Operator.
const NAV_ITEMS: { href: string; label: string; ai?: boolean; minRole?: OrgRole }[] = [
  { href: "/dashboard", label: el.nav.dashboard },
  { href: "/transactions", label: el.nav.transactions },
  { href: "/inbox", label: el.nav.inbox, minRole: "editor" },
  { href: "/projects", label: el.nav.projects },
  // ── Planner (0040) ── tasks, timeline and the unified calendar; sits by
  // projects because every task belongs to one.
  { href: "/planner", label: el.nav.planner },
  // ── end planner ──
  { href: "/properties", label: el.nav.properties },
  { href: "/analysis", label: el.nav.analysis },
  { href: "/vat", label: el.nav.vat },
  { href: "/cashflow", label: el.nav.cashflow },
  { href: "/contacts", label: el.nav.contacts },
  { href: "/accounts", label: el.nav.accounts },
  { href: "/installments", label: el.nav.installments },
  { href: "/revenue-plans", label: el.nav.revenuePlans },
  // Shared with external partners -- the one entry that leads out of the
  // finance shell into the (collab) route group.
  { href: "/collab", label: el.collab.navLabel },
  { href: "/assistant", label: el.nav.assistant, ai: true },
  { href: "/documents/new", label: el.nav.documents, ai: true, minRole: "editor" },
  { href: "/changes", label: el.nav.changes, ai: true, minRole: "editor" },
  { href: "/settings", label: el.nav.settings },
];

// Quality checks and AADE import, parked back out of the nav at the user's
// request -- routes still work at /quality and /aade, just not linked.
// { href: "/quality", label: el.nav.quality },
// { href: "/aade", label: el.nav.aade },
// Withholding (Παρακράτηση) parked for phase 2 at the user's request --
// route still works at /withholding, just hidden from the nav for now.
// { href: "/withholding", label: el.nav.withholding },

export function Nav({
  children,
  orgs,
  currentOrgId,
  role,
}: {
  children: React.ReactNode;
  orgs: { id: string; name: string }[];
  currentOrgId: string;
  role: OrgRole;
}) {
  const pathname = usePathname();
  const items = NAV_ITEMS.filter((item) => !item.minRole || ROLE_RANK[role] >= ROLE_RANK[item.minRole]);

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <nav className="border-b border-line bg-surface md:w-56 md:border-b-0 md:border-r">
        <Link href="/dashboard" className="block px-4 pt-4 pb-2">
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
        <ul className="flex gap-1 overflow-x-auto p-2 text-sm md:flex-col md:overflow-visible">
          {items.map((item) => {
            const active = pathname === item.href || pathname?.startsWith(item.href + "/");
            return (
              <li key={item.href} className="shrink-0">
                <Link
                  href={item.href}
                  className={`flex items-center gap-1.5 rounded-md px-3 py-2 whitespace-nowrap transition-colors ${
                    active
                      ? item.ai
                        ? "bg-ai-bg font-medium text-ai-ink"
                        : "bg-sage font-medium text-sage-ink"
                      : item.ai
                        ? "text-ai-ink hover:bg-ai-bg"
                        : "text-ink-muted hover:bg-bg hover:text-ink"
                  }`}
                >
                  {item.ai && <AiSpark />}
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      <main className="flex-1 bg-bg p-4 md:p-6">{children}</main>
    </div>
  );
}
