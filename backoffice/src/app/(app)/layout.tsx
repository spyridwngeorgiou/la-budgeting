"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { el } from "@/lib/i18n/el";

const NAV_ITEMS: { href: string; label: string }[] = [
  { href: "/dashboard", label: el.nav.dashboard },
  { href: "/assistant", label: el.nav.assistant },
  { href: "/transactions", label: el.nav.transactions },
  { href: "/documents/new", label: el.nav.documents },
  { href: "/projects", label: el.nav.projects },
  { href: "/contacts", label: el.nav.contacts },
  { href: "/accounts", label: el.nav.accounts },
  { href: "/vat", label: el.nav.vat },
  { href: "/withholding", label: el.nav.withholding },
  { href: "/installments", label: el.nav.installments },
  { href: "/cashflow", label: el.nav.cashflow },
  { href: "/analysis", label: el.nav.analysis },
  { href: "/aade", label: el.nav.aade },
  { href: "/quality", label: el.nav.quality },
  { href: "/settings", label: el.nav.settings },
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

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
                  className={`block rounded-md px-3 py-2 whitespace-nowrap transition-colors ${
                    active
                      ? "bg-sage font-medium text-sage-ink"
                      : "text-ink-muted hover:bg-bg hover:text-ink"
                  }`}
                >
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
