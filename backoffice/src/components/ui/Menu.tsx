"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { shell } from "@/lib/i18n/v2/shell";
import { cn } from "./cn";

// The overflow menu «⋯»: secondary actions of a page header or a table row.
// Children are MenuItem / MenuLink (or a server-rendered <form> with a
// MenuItem submit). Closes on Escape, an outside click or picking an item.
export function Menu({
  children,
  label = shell.ui.more,
  trigger,
  align = "right",
  className = "",
}: {
  children: ReactNode;
  label?: string;
  trigger?: ReactNode;
  align?: "left" | "right";
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        button.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={root} className={cn("relative inline-flex", className)}>
      <button
        ref={button}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={id}
        aria-label={trigger ? undefined : label}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex min-h-10 min-w-10 items-center justify-center border border-chip-border px-2 text-ink hover:border-navy hover:bg-hover"
      >
        {trigger ?? <span aria-hidden="true" className="text-lg leading-none">⋯</span>}
      </button>
      {open && (
        <div
          id={id}
          role="menu"
          onClick={(e) => {
            if ((e.target as HTMLElement).closest("[role=menuitem]")) setOpen(false);
          }}
          className={cn(
            "absolute top-full z-30 mt-1 flex min-w-52 flex-col border border-hairline bg-field py-1",
            align === "right" ? "right-0" : "left-0",
          )}
        >
          {children}
        </div>
      )}
    </div>
  );
}

const ITEM = "flex min-h-10 w-full items-center gap-2 px-3 py-2 text-left text-sm text-ink hover:bg-hover disabled:opacity-50";

export function MenuItem({
  tone = "default",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { tone?: "default" | "danger" }) {
  return <button type="button" role="menuitem" className={cn(ITEM, tone === "danger" && "text-negative", className)} {...props} />;
}

export function MenuLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} role="menuitem" className={ITEM}>
      {children}
    </Link>
  );
}

export function MenuSeparator() {
  return <div role="separator" className="my-1 border-t border-hairline" />;
}
