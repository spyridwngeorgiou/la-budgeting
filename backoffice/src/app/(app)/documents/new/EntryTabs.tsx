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

export function EntryTabs({ initial = "photo" }: { initial?: "photo" | "text" }) {
  const [tab, setTab] = useState<"photo" | "text">(initial);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 border-b border-hairline sm:grid-cols-2" role="tablist">
        {CHOICES.map(({ key, icon: Icon, title, text }) => {
          const active = tab === key;
          return (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setTab(key)}
              className={`-mb-px flex min-h-11 items-start gap-3 border-b-2 px-1 py-4 text-left transition-colors sm:px-4 ${
                active ? "border-ai text-ink" : "border-transparent hover:bg-ai-tint"
              }`}
            >
              <span
                className={`flex h-10 w-10 shrink-0 items-center justify-center border ${
                  active ? "border-ai-border text-ai" : "border-hairline text-muted"
                }`}
              >
                <Icon className="h-5 w-5" strokeWidth={1.5} />
              </span>
              <span className="flex flex-col gap-0.5">
                <span className={`text-body ${active ? "text-ai" : "text-ink"}`}>{title}</span>
                <span className="text-sm text-muted">{text}</span>
              </span>
            </button>
          );
        })}
      </div>
      {tab === "photo" ? <UploadForm /> : <NlEntryForm />}
    </div>
  );
}
