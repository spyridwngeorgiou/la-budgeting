"use client";

import { useState } from "react";
import { UploadForm } from "./UploadForm";
import { NlEntryForm } from "./NlEntryForm";

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
            className={`rounded-md px-3 py-2 text-sm font-medium transition-colors ${
              tab === key ? "bg-ink text-white" : "border border-line-strong text-ink hover:bg-bg"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "photo" ? <UploadForm /> : <NlEntryForm />}
    </div>
  );
}
