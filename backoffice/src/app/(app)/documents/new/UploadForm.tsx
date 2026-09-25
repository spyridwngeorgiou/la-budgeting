"use client";

import { useRef, useState } from "react";
import { Camera, FileText, ImageIcon, Upload, X } from "lucide-react";
import { uploadDocument } from "../actions";
import { SubmitButton } from "@/components/SubmitButton";
import { AiSpark } from "@/components/ui";

// What extractDocument (src/lib/ai/extract.ts) can actually read, and the
// documents bucket's size limit (supabase/config.toml) -- checked here so a
// wrong file is rejected immediately with a clear message, not after a
// 30-second AI round trip.
const ACCEPTED = ["application/pdf", "image/jpeg", "image/png", "image/webp"];
const MAX_BYTES = 10 * 1024 * 1024;

function describeProblem(file: File): string | null {
  const name = file.name.toLowerCase();
  if (file.type === "image/heic" || file.type === "image/heif" || name.endsWith(".heic") || name.endsWith(".heif")) {
    return "Οι φωτογραφίες HEIC του iPhone δεν διαβάζονται. Τραβήξτε τη φωτογραφία με το κουμπί «Φωτογραφία με κάμερα» εδώ, ή στο iPhone: Ρυθμίσεις → Κάμερα → Μορφές → «Πιο συμβατή».";
  }
  if (!ACCEPTED.includes(file.type)) {
    return `Το αρχείο «${file.name}» δεν υποστηρίζεται. Δεκτά: PDF, JPG, PNG, WEBP.`;
  }
  if (file.size > MAX_BYTES) {
    return `Το αρχείο είναι ${(file.size / 1024 / 1024).toFixed(1)} MB — το όριο είναι 10 MB.`;
  }
  return null;
}

function formatSize(bytes: number): string {
  return bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function UploadForm() {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const cameraInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  function choose(next: File | undefined | null) {
    if (preview) URL.revokeObjectURL(preview);
    setPreview(null);
    setError(null);
    if (!next) {
      setFile(null);
      return;
    }
    const problem = describeProblem(next);
    if (problem) {
      setFile(null);
      setError(problem);
      return;
    }
    setFile(next);
    if (next.type.startsWith("image/")) setPreview(URL.createObjectURL(next));
  }

  const isPdf = file?.type === "application/pdf";

  return (
    <form
      action={async (formData) => {
        if (!file) {
          setError("Επιλέξτε πρώτα φωτογραφία ή αρχείο.");
          return;
        }
        formData.set("file", file);
        setError(null);
        try {
          await uploadDocument(formData);
        } catch (e) {
          // redirect() throws internally on success -- only real errors land here
          if (e instanceof Error && !e.message.includes("NEXT_REDIRECT")) {
            setError(e.message);
          } else if (!(e instanceof Error)) {
            setError("Σφάλμα.");
          } else {
            throw e;
          }
        }
      }}
      className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4 shadow-sm"
    >
      {/* Two separate inputs on purpose: `capture` makes phones open the
          camera directly, which also makes picking a PDF impossible -- so
          the camera gets its own button and the file picker never captures. */}
      <input
        ref={cameraInput}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => choose(e.target.files?.[0])}
      />
      <input
        ref={fileInput}
        type="file"
        accept=".pdf,application/pdf,image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(e) => choose(e.target.files?.[0])}
      />

      {!file ? (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            choose(e.dataTransfer.files?.[0]);
          }}
          className={`flex min-h-64 flex-col items-center justify-center gap-4 rounded-lg border-2 border-dashed px-6 py-10 text-center transition-colors ${
            dragging ? "border-ai-strong bg-ai-bg" : "border-ai-border bg-ai-bg/30"
          }`}
        >
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-ai-bg text-ai-strong">
            <Upload className="h-7 w-7" />
          </span>
          <div className="flex flex-col gap-1">
            <p className="text-lg font-semibold text-ink">
              {dragging ? "Αφήστε το αρχείο εδώ" : "Σύρετε εδώ το παραστατικό"}
            </p>
            <p className="text-sm text-ink-muted">ή επιλέξτε από τη συσκευή σας</p>
          </div>
          <div className="flex w-full max-w-md flex-col gap-2 sm:flex-row sm:justify-center">
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              className="flex items-center justify-center gap-2 rounded-md bg-ai-strong px-5 py-3 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-ai-ink"
            >
              <FileText className="h-5 w-5" />
              Επιλογή αρχείου
            </button>
            <button
              type="button"
              onClick={() => cameraInput.current?.click()}
              className="flex items-center justify-center gap-2 rounded-md border border-ai-border bg-white px-5 py-3 text-sm font-semibold text-ai-ink transition-colors hover:bg-ai-bg"
            >
              <Camera className="h-5 w-5" />
              Φωτογραφία με κάμερα
            </button>
          </div>
          <p className="text-xs text-ink-faint">PDF, JPG, PNG ή WEBP · έως 10 MB · ένα παραστατικό ανά αρχείο</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3 rounded-lg border-2 border-ai-border bg-ai-bg/30 p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-white shadow-sm">
              {isPdf ? <FileText className="h-6 w-6 text-red-ink" /> : <ImageIcon className="h-6 w-6 text-ai-strong" />}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{file.name}</div>
              <div className="text-xs text-ink-muted">
                {isPdf ? "PDF" : "Εικόνα"} · {formatSize(file.size)}
              </div>
            </div>
            <button
              type="button"
              onClick={() => choose(null)}
              className="rounded p-1 text-ink-muted hover:bg-bg hover:text-ink"
              aria-label="Αφαίρεση αρχείου"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          {preview && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={preview} alt="Προεπισκόπηση" className="max-h-80 rounded-lg border border-line object-contain" />
          )}
        </div>
      )}

      {error && <p className="text-sm text-red-ink">{error}</p>}

      <SubmitButton
        variant={file ? "aiSolid" : "ai"}
        disabled={!file}
        className="w-full py-3 text-base"
        pendingLabel="Ανάλυση παραστατικού… (μπορεί να πάρει ως 30 δευτερόλεπτα)"
      >
        <AiSpark className="mr-1.5" />
        Ανάλυση με AI
      </SubmitButton>
      <p className="text-xs text-ink-faint">
        Τίποτα δεν καταχωρείται αυτόματα — θα δείτε τα στοιχεία που διάβασε το AI και θα τα εγκρίνετε.
      </p>
    </form>
  );
}
