"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  FolderKanban,
  Wallet,
  ArrowLeftRight,
  TrendingUp,
  Settings,
  LogOut,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { signOut } from "@/app/(auth)/actions";

const NAV = [
  { href: "/dashboard", label: "Επισκόπηση", icon: LayoutDashboard },
  { href: "/projects", label: "Έργα", icon: FolderKanban },
  { href: "/accounts", label: "Λογαριασμοί", icon: Wallet },
  { href: "/transactions", label: "Κινήσεις", icon: ArrowLeftRight },
  { href: "/income", label: "Έσοδα", icon: TrendingUp },
  { href: "/settings", label: "Ρυθμίσεις", icon: Settings },
];

// Bottom tab bar shows the 5 core sections on mobile.
const TABS = NAV.slice(0, 5);

export function Sidebar({ email }: { email: string }) {
  const pathname = usePathname();
  const isActive = (href: string) =>
    pathname === href || pathname.startsWith(href + "/");

  return (
    <>
      {/* Mobile top bar */}
      <div className="flex items-center justify-between bg-primary px-4 py-3 text-primary-fg md:hidden">
        <span className="flex items-center gap-2 font-bold">
          <Wallet size={20} /> LA Budgeting
        </span>
        <div className="flex items-center gap-1">
          <Link
            href="/settings"
            className="rounded-lg p-2 hover:bg-white/10"
            aria-label="Ρυθμίσεις"
          >
            <Settings size={20} />
          </Link>
          <form action={signOut}>
            <button
              className="rounded-lg p-2 hover:bg-white/10"
              aria-label="Αποσύνδεση"
            >
              <LogOut size={20} />
            </button>
          </form>
        </div>
      </div>

      {/* Desktop / tablet sidebar */}
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-border bg-primary text-primary-fg md:flex">
        <div className="flex items-center gap-2 px-6 py-5">
          <Wallet size={22} />
          <span className="text-lg font-bold">LA Budgeting</span>
        </div>

        <nav className="flex-1 space-y-1 px-3 py-3">
          {NAV.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition",
                isActive(href)
                  ? "bg-white/15 text-white"
                  : "text-white/70 hover:bg-white/10 hover:text-white",
              )}
            >
              <Icon size={18} />
              {label}
            </Link>
          ))}
        </nav>

        <div className="border-t border-white/10 px-4 py-3">
          <p className="mb-2 truncate text-xs text-white/60">{email}</p>
          <form action={signOut}>
            <button className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-white/80 transition hover:bg-white/10">
              <LogOut size={16} />
              Αποσύνδεση
            </button>
          </form>
        </div>
      </aside>

      {/* Mobile bottom tab bar */}
      <nav className="fixed inset-x-0 bottom-0 z-40 flex border-t border-border bg-white shadow-[0_-1px_6px_rgba(0,0,0,0.05)] md:hidden">
        {TABS.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className={cn(
              "flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] font-medium transition",
              isActive(href) ? "text-primary" : "text-muted",
            )}
          >
            <Icon size={20} />
            {label}
          </Link>
        ))}
      </nav>
    </>
  );
}
