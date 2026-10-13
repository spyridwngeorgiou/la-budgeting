"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { registerUpload } from "./actions";

// «+ Ανέβασμα εγγράφου»: pick a category, pick one or more files, done.
export const CATEGORIES = ["Άδειες & εγκρίσεις", "Συμβάσεις", "Προσφορές", "Τιμολόγια & αποδείξεις", "Σχέδια & φωτογραφίες", "Λοιπά"];

// Storage keys must be plain ASCII; the real name is kept in the catalogue.
const safeKey = (name: string) => name.normalize("NFKD").replace(/[^A-Za-z0-9._-]+/g, "_").replace(/_+/g, "_").slice(-80) || "file";

export function UploadButton({ projectId, orgId }: { projectId: string; orgId: string }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState(CATEGORIES[0]);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    const supabase = createClient();
    try {
      for (const [i, f] of [...files].entries()) {
        setStatus(`Ανεβαίνει ${i + 1} από ${files.length}: ${f.name}`);
        const path = `${orgId}/projects/${projectId}/${Date.now()}-${safeKey(f.name)}`;
        const { error } = await supabase.storage.from("documents").upload(path, f, { contentType: f.type || undefined });
        if (error) throw new Error(error.message);
        await registerUpload(projectId, { path, title: f.name, mime: f.type || null, size: f.size, category });
      }
      setStatus(`✓ Ανέβηκαν ${files.length} ${files.length === 1 ? "αρχείο" : "αρχεία"} στο «${category}».`);
      setOpen(false);
      router.refresh();
    } catch (e) {
      setStatus(`Δεν ανέβηκε: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {!open ? (
        <button type="button" onClick={() => setOpen(true)} className="self-start rounded-md border border-line bg-surface px-3 py-1.5 text-sm hover:bg-bg">
          + Ανέβασμα εγγράφου
        </button>
      ) : (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-line bg-surface p-3 text-sm">
          <span className="text-ink-muted">Φάκελος</span>
          <select value={category} onChange={(e) => setCategory(e.target.value)} className="rounded-md border border-line bg-surface px-2 py-1">
            {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
          </select>
          <input ref={input} type="file" multiple disabled={busy} onChange={(e) => upload(e.target.files)} className="text-sm" />
          <button type="button" onClick={() => setOpen(false)} disabled={busy} className="text-ink-muted hover:underline">Άκυρο</button>
        </div>
      )}
      {status && <p className="text-xs text-ink-muted">{status}</p>}
    </div>
  );
}
