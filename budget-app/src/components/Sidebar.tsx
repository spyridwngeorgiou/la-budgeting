"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  LayoutDashboard,
  FolderKanban,
  Wallet,
  ArrowLeftRight,
  TrendingUp,
  Menu,
  X,
  LogOut,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { signOut } from "@/app/(auth)/actions";

const NAV = [
  { href: "/dashboard", label: "Επισκόπηση", icon: LayoutDashboard },
  { href: "/projects", label: "Έργα", icon: FolderKanban },
  { href: "/accounts", label: "Λογαριασμοί", icon: Wallet },
  { href: "/transactions", label: "Κινήσεις", icon: ArrowLeftRight },
  { href: "/income", label: "Αναμενόμενα έσοδα", icon: TrendingUp },
];

export function Sidebar({ email }: { email: string }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* Mobile top bar */}
      <div className="flex items-center justify-between border-b border-border bg-primary px-4 py-3 text-primary-fg md:hidden">
        <span className="font-bold">LA Budgeting</span>
        <button onClick={() => setOpen((v) => !v)} aria-label="Μενού">
          {open ? <X size={22} /> : <Menu size={22} />}
        </button>
      </div>

      <aside
        className={cn(
          "flex w-full flex-col border-r border-border bg-primary text-primary-fg md:h-screen md:w-64 md:shrink-0",
          open ? "block" : "hidden md:flex",
        )}
      >
        <div className="hidden items-center gap-2 px-6 py-5 md:flex">
          <Wallet size={22} />
          <span className="text-lg font-bold">LA Budgeting</span>
        </div>

        <nav className="flex-1 space-y-1 px-3 py-3">
          {NAV.map(({ href, label, icon: Icon }) => {
            const active =
              pathname === href || pathname.startsWith(href + "/");
            return (
              <Link
                key={href}
                href={href}
                onClick={() => setOpen(false)}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition",
                  active
                    ? "bg-white/15 text-white"
                    : "text-white/70 hover:bg-white/10 hover:text-white",
                )}
              >
                <Icon size={18} />
                {label}
              </Link>
            );
          })}
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
    </>
  );
}
