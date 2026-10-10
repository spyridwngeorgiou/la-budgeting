"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/components/ui/cn";
import { activeDestination, canCapture, navForRole, type Destination, type ShellRole } from "@/lib/navigation";
import { shell } from "@/lib/i18n/v2/shell";
import { CaptureButton } from "./CaptureSheet";
import { DESTINATION_ICON } from "./icons";

// Phones (< md): Σήμερα · Χρήματα · ＋ · Έργα · Πλάνο. Εκκρεμότητες and
// Ρώτα sit in the top bar instead. The active item has a 2px navy bar on
// top, no fill. Partners: Έργα · Πλάνο, no «＋».
export function BottomBar({ role }: { role: ShellRole }) {
  const pathname = usePathname() ?? "";
  const all = navForRole(role);
  const items = all.filter((d) => d.mobile);
  const active = activeDestination(all, pathname);
  const half = Math.ceil(items.length / 2);

  const link = (d: Destination) => {
    const Icon = DESTINATION_ICON[d.key];
    const isActive = active?.key === d.key;
    return (
      <li key={d.key} className="flex-1">
        <Link
          href={d.href}
          aria-current={isActive ? "page" : undefined}
          className={cn(
            "flex h-bottombar flex-col items-center justify-center gap-1 border-t-2 text-xs",
            isActive ? "border-navy font-medium text-ink" : "border-transparent text-muted",
          )}
        >
          <Icon aria-hidden="true" className="h-5 w-5" strokeWidth={1.5} />
          {d.label}
        </Link>
      </li>
    );
  };

  return (
    <nav
      aria-label={shell.nav.main}
      className="fixed inset-x-0 bottom-0 z-30 border-t border-hairline bg-canvas pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      <ul className="flex items-stretch">
        {canCapture(role) ? (
          <>
            {items.slice(0, half).map(link)}
            <li className="flex flex-1 items-center justify-center">
              <CaptureButton variant="bottom" />
            </li>
            {items.slice(half).map(link)}
          </>
        ) : (
          items.map(link)
        )}
      </ul>
    </nav>
  );
}
