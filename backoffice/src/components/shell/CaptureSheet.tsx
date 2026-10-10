"use client";

import Link from "next/link";
import { useState } from "react";
import { Camera, FileSpreadsheet, Landmark, MessageSquareText, PenLine, Plus, type LucideIcon } from "lucide-react";
import { Drawer } from "@/components/ui/Drawer";
import { cn } from "@/components/ui/cn";
import { shell } from "@/lib/i18n/v2/shell";

// «＋ Καταχώριση»: one place to start any capture. For now each option
// links to today's entry point; Phase 2 turns them into steps of one flow
// that stages an ingest batch and opens /inbox/[batchId].
const OPTIONS: { href: string; label: string; hint: string; icon: LucideIcon }[] = [
  { href: "/documents/new", label: shell.capture.photo, hint: shell.capture.photoHint, icon: Camera },
  { href: "/inbox", label: shell.capture.bank, hint: shell.capture.bankHint, icon: FileSpreadsheet },
  { href: "/aade", label: shell.capture.aade, hint: shell.capture.aadeHint, icon: Landmark },
  { href: "/documents/new?mode=text", label: shell.capture.text, hint: shell.capture.textHint, icon: MessageSquareText },
  { href: "/transactions", label: shell.capture.manual, hint: shell.capture.manualHint, icon: PenLine },
];

export function CaptureSheet({ onClose }: { onClose: () => void }) {
  return (
    <Drawer onClose={onClose} title={shell.capture.title}>
      <ul className="flex flex-col border-t border-hairline">
        {OPTIONS.map((o) => (
          <li key={o.href} className="border-b border-hairline">
            <Link href={o.href} onClick={onClose} className="flex min-h-14 items-center gap-4 px-1 py-3 hover:bg-hover">
              <o.icon aria-hidden="true" className="h-5 w-5 shrink-0 text-navy" strokeWidth={1.5} />
              <span className="flex min-w-0 flex-col">
                <span className="text-body text-ink">{o.label}</span>
                <span className="text-small text-muted">{o.hint}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </Drawer>
  );
}

// The button that opens the sheet: the rail's primary button (full or
// icon-only) or the bottom bar's centre «＋».
export function CaptureButton({ variant }: { variant: "rail" | "icon" | "bottom" }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={variant === "rail" ? undefined : shell.nav.capture}
        title={variant === "icon" ? shell.nav.capture : undefined}
        className={cn(
          "inline-flex items-center justify-center gap-2 border border-navy bg-navy text-sm font-medium text-panel-ink hover:border-navy-strong hover:bg-navy-strong",
          variant === "rail" && "min-h-10 w-full px-4",
          variant === "icon" && "h-10 w-10",
          variant === "bottom" && "h-11 w-11",
        )}
      >
        <Plus aria-hidden="true" className="h-4 w-4" strokeWidth={2} />
        {variant === "rail" && shell.nav.capture}
      </button>
      {open && <CaptureSheet onClose={() => setOpen(false)} />}
    </>
  );
}
