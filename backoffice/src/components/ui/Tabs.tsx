"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { activeTab, type SubNavTab } from "@/lib/navigation";
import { cn } from "./cn";

// A section's tabs. Each tab is a real route; the active one is the longest
// href that owns the current path (same rule as the legacy SubNav).
// `query` is appended to every href (to carry filters across tabs).
export function Tabs({ tabs, label, query = "", className = "" }: { tabs: SubNavTab[]; label: string; query?: string; className?: string }) {
  const pathname = usePathname() ?? "";
  const active = activeTab(tabs, pathname);
  return (
    <nav aria-label={label} className={cn("flex gap-1 overflow-x-auto border-b border-hairline", className)}>
      {tabs.map((t) => {
        const isActive = t.href === active;
        return (
          <Link
            key={t.href}
            href={`${t.href}${query}`}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "-mb-px min-h-10 border-b-2 px-3 py-2.5 text-sm whitespace-nowrap",
              isActive ? "border-navy text-ink" : "border-transparent text-muted hover:text-ink",
            )}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
