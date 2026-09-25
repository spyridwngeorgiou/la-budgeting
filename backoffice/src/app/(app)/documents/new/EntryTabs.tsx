"use client";

import { useState } from "react";
import { FileText, MessageSquareText } from "lucide-react";
import { UploadForm } from "./UploadForm";
import { NlEntryForm } from "./NlEntryForm";

const CHOICES = [
  {
    key: "photo",
    icon: FileText,
    title: "Έχω παραστατικό",
    text: "Φωτογραφία ή PDF τιμολογίου / απόδειξης. Το AI διαβάζει ποσά, ΦΠΑ, ΑΦΜ και ημερομηνία.",
  },
  {
    key: "text",
    icon: MessageSquareText,
    title: "Δεν έχω παραστατικό",
    text: "Γράψτε ή πείτε την κίνηση, π.χ. «πλήρωσα 50 € βενζίνη μετρητά για τη Λαζαράκη».",
  },
] as const;

export function EntryTabs() {
  const [tab, setTab] = useState<"photo" | "text">("photo");

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2" role="tablist">
        {CHOICES.map(({ key, icon: Icon, title, text }) => {
          const active = tab === key;
          return (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setTab(key)}
              className={`flex items-start gap-3 rounded-lg border-2 bg-surface p-4 text-left transition-all ${
                active
                  ? "border-ai-strong shadow-sm ring-4 ring-ai-bg"
                  : "border-line hover:border-ai-border hover:bg-ai-bg/40"
              }`}
            >
              <span
                className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${
                  active ? "bg-ai-strong text-white" : "bg-bg text-ink-muted"
                }`}
              >
                <Icon className="h-5 w-5" />
              </span>
              <span className="flex flex-col gap-0.5">
                <span className={`text-base font-semibold ${active ? "text-ai-ink" : "text-ink"}`}>{title}</span>
                <span className="text-sm text-ink-muted">{text}</span>
              </span>
            </button>
          );
        })}
      </div>
      {tab === "photo" ? <UploadForm /> : <NlEntryForm />}
    </div>
  );
}
