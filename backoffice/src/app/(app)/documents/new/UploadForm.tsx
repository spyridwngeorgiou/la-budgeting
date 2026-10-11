"use client";

import { useRef, useState } from "react";
import { Camera, FileText, ImageIcon, Upload, X } from "lucide-react";
import { uploadDocument } from "../actions";
import { SubmitButton } from "@/components/SubmitButton";
import { AiSpark } from "@/components/ui";
import { errorOf } from "@/lib/actions";

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
        // Success redirects to the review screen; failures come back as { error }.
        const message = errorOf(await uploadDocument(formData));
        if (message) setError(message);
      }}
      className="flex flex-col gap-3"
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
          className={`flex min-h-64 flex-col items-center justify-center gap-4 border border-dashed px-4 py-10 text-center transition-colors sm:px-6 ${
            dragging ? "border-ai bg-ai-tint" : "border-ai-border"
          }`}
        >
          <span className="flex h-12 w-12 items-center justify-center border border-ai-border text-ai">
            <Upload className="h-6 w-6" strokeWidth={1.5} />
          </span>
          <div className="flex flex-col gap-1">
            <p className="text-section font-normal text-ink">
              {dragging ? "Αφήστε το αρχείο εδώ" : "Σύρετε εδώ το παραστατικό"}
            </p>
            <p className="text-sm text-muted">ή επιλέξτε από τη συσκευή σας</p>
          </div>
          <div className="flex w-full max-w-md flex-col gap-2 sm:flex-row sm:justify-center">
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              className="flex min-h-11 items-center justify-center gap-2 border border-navy bg-navy px-5 py-2.5 text-sm font-medium text-panel-ink transition-colors hover:border-navy-strong hover:bg-navy-strong"
            >
              <FileText className="h-5 w-5" strokeWidth={1.5} />
              Επιλογή αρχείου
            </button>
            <button
              type="button"
              onClick={() => cameraInput.current?.click()}
              className="flex min-h-11 items-center justify-center gap-2 border border-ai-border px-5 py-2.5 text-sm font-medium text-ai transition-colors hover:bg-ai-tint"
            >
              <Camera className="h-5 w-5" strokeWidth={1.5} />
              Φωτογραφία με κάμερα
            </button>
          </div>
          <p className="text-xs text-muted">PDF, JPG, PNG ή WEBP · έως 10 MB · ένα παραστατικό ανά αρχείο</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3 border-y border-ai-border py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center border border-hairline bg-field">
              {isPdf ? <FileText className="h-6 w-6 text-muted" strokeWidth={1.5} /> : <ImageIcon className="h-6 w-6 text-muted" strokeWidth={1.5} />}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm text-ink">{file.name}</div>
              <div className="text-xs text-muted">
                {isPdf ? "PDF" : "Εικόνα"} · {formatSize(file.size)}
              </div>
            </div>
            <button
              type="button"
              onClick={() => choose(null)}
              className="flex h-11 w-11 items-center justify-center text-muted hover:bg-hover hover:text-ink"
              aria-label="Αφαίρεση αρχείου"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          {preview && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={preview} alt="Προεπισκόπηση" className="max-h-80 border border-hairline object-contain" />
          )}
        </div>
      )}

      {error && (
        <p role="alert" className="border-l-2 border-negative pl-3 text-sm text-negative">
          {error}
        </p>
      )}

      <SubmitButton
        variant={file ? "aiSolid" : "ai"}
        disabled={!file}
        className="w-full py-3 text-base"
        pendingLabel="Ανάλυση παραστατικού… (μπορεί να πάρει ως 30 δευτερόλεπτα)"
      >
        <AiSpark className="mr-1.5" />
        Ανάλυση με AI
      </SubmitButton>
      <p className="text-xs text-muted">
        Τίποτα δεν καταχωρείται αυτόματα — θα δείτε τα στοιχεία που διάβασε το AI και θα τα εγκρίνετε.
      </p>
    </form>
  );
}
