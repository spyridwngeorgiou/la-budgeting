"use client";

import { useState } from "react";
import { UploadForm } from "./UploadForm";
import { NlEntryForm } from "./NlEntryForm";
import { AiSpark } from "@/components/ui";

export function EntryTabs() {
  const [tab, setTab] = useState<"photo" | "text">("photo");

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        {([
          ["photo", "Έχω παραστατικό", "φωτογραφία ή PDF"],
          ["text", "Δεν έχω παραστατικό", "γράψτε ή πείτε την κίνηση"],
        ] as const).map(([key, label, hint]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-2 text-center text-sm font-medium transition-colors ${
              tab === key
                ? "border border-ai-border bg-ai-bg text-ai-ink"
                : "border border-line-strong text-ink hover:bg-bg"
            }`}
          >
            {tab === key && <AiSpark />}
            <span className="flex flex-col leading-tight">
              <span>{label}</span>
              <span className="text-xs font-normal opacity-70">{hint}</span>
            </span>
          </button>
        ))}
      </div>
      {tab === "photo" ? <UploadForm /> : <NlEntryForm />}
    </div>
  );
}
