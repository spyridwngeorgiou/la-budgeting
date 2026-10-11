"use client";

import Link from "next/link";
import { useState } from "react";
import { FileSpreadsheet, FileText, Landmark, MessageSquareText } from "lucide-react";
import { el } from "@/lib/i18n/el";
import { UploadForm } from "./UploadForm";

// The one «Ανέβασμα» area: every way data gets into the app starts here.
// Bank statements upload inline; the other three open their own flows.
const CHOICES = [
  { key: "bank", icon: Landmark, title: el.upload.bank, text: el.upload.bankHint, href: null },
  { key: "aade", icon: FileSpreadsheet, title: el.upload.aade, text: el.upload.aadeHint, href: "/aade" },
  { key: "document", icon: FileText, title: el.upload.document, text: el.upload.documentHint, href: "/documents/new" },
  { key: "text", icon: MessageSquareText, title: el.upload.text, text: el.upload.textHint, href: "/documents/new?mode=text" },
] as const;

export function UploadChooser({ accounts }: { accounts: { id: string; label: string }[] }) {
  const [showBank, setShowBank] = useState(true);
  return (
    <section className="flex flex-col gap-3" aria-labelledby="upload-title">
      <div className="border-b border-hairline pb-3">
        <h2 id="upload-title" className="text-section font-normal text-ink">
          {el.upload.title}
        </h2>
        <p className="mt-1 text-sm text-muted">{el.upload.hint}</p>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {CHOICES.map(({ key, icon: Icon, title, text, href }) => {
          const active = key === "bank" && showBank;
          const className = `flex min-h-11 items-start gap-3 border p-3 text-left transition-colors ${
            active ? "border-navy bg-hover" : "border-hairline hover:border-chip-border hover:bg-hover"
          }`;
          const body = (
            <>
              <Icon className={`mt-0.5 h-5 w-5 shrink-0 ${active ? "text-navy" : "text-muted"}`} strokeWidth={1.5} aria-hidden />
              <span className="flex flex-col gap-0.5">
                <span className="text-sm text-ink">{title}</span>
                <span className="text-xs text-muted">{text}</span>
              </span>
            </>
          );
          return href ? (
            <Link key={key} href={href} className={className}>
              {body}
            </Link>
          ) : (
            <button key={key} type="button" aria-expanded={showBank} onClick={() => setShowBank((v) => !v)} className={className}>
              {body}
            </button>
          );
        })}
      </div>
      {showBank && <UploadForm accounts={accounts} />}
    </section>
  );
}
