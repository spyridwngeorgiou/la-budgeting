"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { activeTab, type SubNavTab } from "@/lib/navigation";

// A section's tab strip (Κινήσεις · Δόσεις · Ανάλυση …). Each tab is a real
// route; the active one is the longest href that owns the current path.
export function SubNav({ tabs, label, query = "" }: { tabs: SubNavTab[]; label: string; query?: string }) {
  const pathname = usePathname() ?? "";
  const active = activeTab(tabs, pathname);
  return (
    <nav className="flex gap-1 overflow-x-auto border-b border-line" aria-label={label}>
      {tabs.map((t) => {
        const isActive = t.href === active;
        return (
          <Link
            key={t.href}
            href={`${t.href}${query}`}
            aria-current={isActive ? "page" : undefined}
            className={`-mb-px border-b-2 px-3 py-2 text-sm whitespace-nowrap ${
              isActive ? "border-ink font-medium text-ink" : "border-transparent text-ink-muted hover:text-ink"
            }`}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}

// SubNav that carries some search params across tabs (the planner keeps
// project and assignee). Uses useSearchParams, so wrap it in <Suspense>.
export function SubNavKeepingParams({ keep, ...props }: { tabs: SubNavTab[]; label: string; keep: string[] }) {
  const params = useSearchParams();
  const kept = new URLSearchParams();
  for (const k of keep) {
    const v = params.get(k);
    if (v) kept.set(k, v);
  }
  const qs = kept.toString();
  return <SubNav {...props} query={qs ? `?${qs}` : ""} />;
}
