"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Settings } from "lucide-react";
import { Brand } from "@/components/ui/Brand";
import { cn } from "@/components/ui/cn";
import { activeDestination, canCapture, navForRole, SETTINGS_V2, type ShellRole } from "@/lib/navigation";
import { shell } from "@/lib/i18n/v2/shell";
import { switchOrg } from "@/app/(app)/org-actions";
import { CaptureButton } from "./CaptureSheet";
import { DESTINATION_ICON } from "./icons";

// The left column from md up. lg: mark + wordmark, org switcher,
// «＋ Καταχώριση», the five destinations (a count on Εκκρεμότητες) and
// Ρυθμίσεις at the bottom. md: the same as an icon rail. The active
// destination has a 2px navy bar on its left, no fill.
export function Rail({
  role,
  pendingCount,
  orgs,
  currentOrgId,
}: {
  role: ShellRole;
  pendingCount: number;
  orgs: { id: string; name: string }[];
  currentOrgId: string | null;
}) {
  const pathname = usePathname() ?? "";
  const items = navForRole(role);
  const active = activeDestination(items, pathname);
  const settingsActive = pathname === SETTINGS_V2.href || pathname.startsWith(`${SETTINGS_V2.href}/`);

  return (
    <aside className="sticky top-0 hidden h-dvh w-rail-collapsed shrink-0 flex-col border-r border-hairline bg-canvas md:flex lg:w-rail">
      <Link href={items[0]?.href ?? "/"} className="flex h-topbar shrink-0 items-center justify-center px-4 lg:justify-start lg:px-5">
        <Brand className="hidden lg:inline-flex" />
        <Brand compact className="lg:hidden" />
      </Link>

      {orgs.length > 1 && currentOrgId && (
        <form action={switchOrg} className="hidden px-5 pb-3 lg:block">
          <label className="sr-only" htmlFor="rail-org">
            {shell.nav.org}
          </label>
          <select
            id="rail-org"
            name="org_id"
            defaultValue={currentOrgId}
            onChange={(e) => e.currentTarget.form?.requestSubmit()}
            className="min-h-9 w-full border border-field-border bg-field px-2 text-small text-ink"
          >
            {orgs.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </form>
      )}

      {canCapture(role) && (
        <div className="flex justify-center px-3 pb-4 lg:px-5">
          <div className="hidden w-full lg:block">
            <CaptureButton variant="rail" />
          </div>
          <div className="lg:hidden">
            <CaptureButton variant="icon" />
          </div>
        </div>
      )}

      <nav aria-label={shell.nav.main} className="flex-1 overflow-y-auto">
        <ul className="flex flex-col">
          {items.map((d) => {
            const Icon = DESTINATION_ICON[d.key];
            const isActive = active?.key === d.key;
            const count = d.counted && pendingCount > 0 ? pendingCount : null;
            return (
              <li key={d.key}>
                <Link
                  href={d.href}
                  aria-current={isActive ? "page" : undefined}
                  title={d.label}
                  className={cn(
                    "relative flex min-h-11 items-center justify-center gap-3 border-l-2 px-3 text-sm lg:justify-start lg:px-5",
                    isActive ? "border-navy font-medium text-ink" : "border-transparent text-text hover:bg-hover hover:text-ink",
                  )}
                >
                  <Icon aria-hidden="true" className="h-5 w-5 shrink-0" strokeWidth={1.5} />
                  <span className="sr-only lg:not-sr-only">{d.label}</span>
                  {count !== null && (
                    <span className="num absolute top-1 right-2 text-xs text-navy lg:static lg:ml-auto lg:text-small">
                      {count}
                      <span className="sr-only"> {shell.nav.pending}</span>
                    </span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {role !== "partner" && (
        <Link
          href={SETTINGS_V2.href}
          aria-current={settingsActive ? "page" : undefined}
          title={SETTINGS_V2.label}
          className={cn(
            "flex min-h-12 shrink-0 items-center justify-center gap-3 border-t border-l-2 border-t-hairline px-3 text-sm lg:justify-start lg:px-5",
            settingsActive ? "border-l-navy font-medium text-ink" : "border-l-transparent text-text hover:bg-hover hover:text-ink",
          )}
        >
          <Settings aria-hidden="true" className="h-5 w-5 shrink-0" strokeWidth={1.5} />
          <span className="sr-only lg:not-sr-only">{SETTINGS_V2.label}</span>
        </Link>
      )}
    </aside>
  );
}
