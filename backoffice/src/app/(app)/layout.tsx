"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { countAlerts } from "@/lib/alerts";
import { el } from "@/lib/i18n/el";
import { AiSpark } from "@/components/ui";

// Ordered deliberately, not alphabetically: the AI features lead (the
// "wow factor" the whole point of a demo is to show), then the screens used
// daily, then the more technical/back-office screens, Settings last.
const NAV_ITEMS: { href: string; label: string; ai?: boolean }[] = [
  { href: "/notifications", label: el.nav.notifications },
  { href: "/dashboard", label: el.nav.dashboard },
  { href: "/assistant", label: el.nav.assistant, ai: true },
  { href: "/documents/new", label: el.nav.documents, ai: true },
  { href: "/changes", label: el.nav.changes, ai: true },
  { href: "/revenue-plans", label: el.nav.revenuePlans, ai: true },
  { href: "/transactions", label: el.nav.transactions },
  { href: "/planned", label: el.nav.planned },
  { href: "/analysis", label: el.nav.analysis },
  { href: "/projects", label: el.nav.projects },
  { href: "/contacts", label: el.nav.contacts },
  { href: "/accounts", label: el.nav.accounts },
  { href: "/aade", label: "myDATA (ΑΑΔΕ)" },
  { href: "/vat", label: el.nav.vat },
  { href: "/withholding", label: el.nav.withholding },
  { href: "/installments", label: el.nav.installments },
  { href: "/cashflow", label: el.nav.cashflow },
  { href: "/scenarios", label: el.nav.scenarios },
  { href: "/activity", label: el.nav.activity },
  { href: "/settings", label: el.nav.settings },
];

// Not deleted, just not in the nav yet -- both still work at their URLs
// (/aade, /quality) for anyone who needs them, this just keeps a first
// look at the app from leading with the more "in-progress" screens.
// { href: "/aade", label: el.nav.aade },
// { href: "/quality", label: el.nav.quality },

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  // Red count next to «Ειδοποιήσεις»: overdue + due within 7 days, refreshed on every page change.
  const [alerts, setAlerts] = useState(0);
  useEffect(() => {
    countAlerts(createClient()).then(setAlerts).catch(() => setAlerts(0));
  }, [pathname]);

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
        <ul className="flex gap-1 overflow-x-auto p-2 text-sm md:flex-col md:overflow-visible">
          {NAV_ITEMS.map((item) => {
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
                  {item.href === "/notifications" && alerts > 0 && (
                    <span className="ml-auto rounded-full bg-red-ink px-1.5 text-[11px] font-medium leading-5 text-white">{alerts}</span>
                  )}
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
