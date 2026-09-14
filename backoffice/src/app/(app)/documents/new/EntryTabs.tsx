"use client";

import { useState } from "react";
import { UploadForm } from "./UploadForm";
import { NlEntryForm } from "./NlEntryForm";
import { AiSpark } from "@/components/ui";

export function EntryTabs() {
  const [tab, setTab] = useState<"photo" | "text">("photo");

  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-2">
        {([
          ["photo", "Φωτογραφία / PDF"],
          ["text", "Περιγραφή (κείμενο ή φωνή)"],
        ] as const).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`flex items-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
              tab === key
                ? "border border-ai-border bg-ai-bg text-ai-ink"
                : "border border-line-strong text-ink hover:bg-bg"
            }`}
          >
            {tab === key && <AiSpark />}
            {label}
          </button>
        ))}
      </div>
      {tab === "photo" ? <UploadForm /> : <NlEntryForm />}
    </div>
  );
}
