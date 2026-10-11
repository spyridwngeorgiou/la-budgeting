"use client";

import { useRef, useState, useTransition } from "react";
import { formatBytes } from "@/lib/format";
import { Camera, FileSpreadsheet, FileText, Landmark, Upload, X } from "lucide-react";
import { AiSpark, Button, Select } from "@/components/ui";
import { errorOf } from "@/lib/actions";
import { el } from "@/lib/i18n/el";
import {
  detectCaptureKind,
  documentMimeType,
  extensionOf,
  xlsxStrings,
  type CaptureKind,
  type CaptureProblem,
} from "@/lib/ingest/captureKind";
import { uploadBankStatement } from "./actions";
import { uploadDocument } from "../documents/actions";
import { uploadAadeFile } from "../aade/actions";

// «Φωτογραφία ή αρχείο» of /inbox/new: one drop zone for every file. The
// kind is detected (lib/ingest/captureKind.ts) and the file goes to the
// importer that already exists for it; each one stages a batch and
// redirects to its review, /inbox/[batchId].

const DOC_MAX_BYTES = 10 * 1024 * 1024; // documents bucket limit (supabase/config.toml)
const SNIFF_MAX_BYTES = 20 * 1024 * 1024;

const KIND_META = {
  document: { icon: FileText, title: el.upload.document, text: el.upload.documentHint },
  bank: { icon: Landmark, title: el.upload.bank, text: el.upload.bankHint },
  aade: { icon: FileSpreadsheet, title: el.upload.aade, text: el.upload.aadeHint },
} as const;

const PROBLEM_TEXT: Record<CaptureProblem, string> = {
  heic: "Οι φωτογραφίες HEIC του iPhone δεν διαβάζονται. Τραβήξτε τη φωτογραφία με το κουμπί «Φωτογραφία» εδώ, ή στο iPhone: Ρυθμίσεις → Κάμερα → Μορφές → «Πιο συμβατή».",
  xls: "Τα παλιά .xls δεν διαβάζονται: ανοίξτε το στο Excel και αποθηκεύστε ως .xlsx.",
  type: "Το αρχείο δεν υποστηρίζεται. Δεκτά: φωτογραφία ή PDF παραστατικού, CSV/XLSX τράπεζας, XLSX myDATA.",
};

async function sniff(file: File): Promise<{ head: Uint8Array; text: string | null }> {
  const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const zip = head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04;
  if (zip && file.size <= SNIFF_MAX_BYTES) {
    return { head, text: await xlsxStrings(new Uint8Array(await file.arrayBuffer())) };
  }
  if (["csv", "txt", "xls"].includes(extensionOf(file.name)) || file.type.startsWith("text/")) {
    return { head, text: await file.slice(0, 4096).text() };
  }
  return { head, text: null };
}

const formatSize = formatBytes;

export function UploadChooser({
  accounts,
  aiOn,
  afmMissing,
}: {
  accounts: { id: string; label: string }[];
  aiOn: boolean;
  afmMissing: boolean;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [mime, setMime] = useState<string | null>(null);
  const [kind, setKind] = useState<CaptureKind | null>(null);
  const [accountId, setAccountId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [pending, startTransition] = useTransition();
  const fileInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);

  async function choose(next: File | undefined | null) {
    setError(null);
    setFile(null);
    setKind(null);
    if (!next) return;
    const { head, text } = await sniff(next);
    const info = { name: next.name, type: next.type, head, text };
    const found = detectCaptureKind(info);
    if ("problem" in found) {
      setError(PROBLEM_TEXT[found.problem]);
      return;
    }
    if (found.kind === "document") {
      if (!aiOn) {
        setError("Ο βοηθός AI δεν είναι ενεργοποιημένος, οπότε τα παραστατικά δεν διαβάζονται ακόμα.");
        return;
      }
      if (next.size > DOC_MAX_BYTES) {
        setError(`Το αρχείο είναι ${formatSize(next.size)} — το όριο για παραστατικά είναι 10 MB.`);
        return;
      }
    }
    setMime(found.kind === "document" ? documentMimeType(info) : null);
    setFile(next);
    setKind(found.kind);
  }

  function submit() {
    if (!file || !kind) return;
    if (kind === "bank" && !accountId) {
      setError("Επιλέξτε τον λογαριασμό στον οποίο ανήκει το αντίγραφο.");
      return;
    }
    const formData = new FormData();
    // The AI reader trusts the MIME type; give it the one the bytes say.
    formData.set("file", kind === "document" && mime && mime !== file.type ? new File([file], file.name, { type: mime }) : file);
    if (kind === "bank") formData.set("account_id", accountId);
    setError(null);
    startTransition(async () => {
      // Success redirects to /inbox/[batchId]; failures come back as { error }.
      const result =
        kind === "document"
          ? await uploadDocument(formData)
          : kind === "aade"
            ? await uploadAadeFile(formData)
            : await uploadBankStatement(formData);
      const message = errorOf(result);
      if (message) setError(message);
    });
  }

  const meta = kind ? KIND_META[kind] : null;
  const KindIcon = meta?.icon ?? FileText;

  return (
    <div className="flex flex-col gap-3">
      <input
        ref={fileInput}
        type="file"
        accept=".pdf,application/pdf,image/jpeg,image/png,image/webp,.csv,.txt,.xls,.xlsx"
        className="hidden"
        onChange={(e) => {
          void choose(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      {/* Its own input: `capture` opens the phone camera directly, which
          would make picking a PDF or a statement impossible. */}
      <input
        ref={cameraInput}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          void choose(e.target.files?.[0]);
          e.target.value = "";
        }}
      />

      {!file || !meta ? (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            void choose(e.dataTransfer.files?.[0]);
          }}
          className={`flex min-h-56 flex-col items-center justify-center gap-4 border border-dashed px-4 py-8 text-center transition-colors sm:px-6 ${
            dragging ? "border-navy bg-hover" : "border-chip-border"
          }`}
        >
          <span className="flex h-12 w-12 items-center justify-center border border-hairline text-muted">
            <Upload className="h-6 w-6" strokeWidth={1.5} aria-hidden />
          </span>
          <div className="flex flex-col gap-1">
            <p className="text-section font-normal text-ink">{dragging ? "Αφήστε το αρχείο εδώ" : "Σύρετε εδώ το αρχείο"}</p>
            <p className="text-body text-muted">Παραστατικό (φωτογραφία ή PDF), αντίγραφο τράπεζας (CSV/XLSX) ή αρχείο myDATA (XLSX)</p>
          </div>
          <div className="flex w-full max-w-md flex-col gap-2 sm:flex-row sm:justify-center">
            <Button type="button" className="min-h-11 gap-2" onClick={() => fileInput.current?.click()}>
              <FileText className="h-5 w-5" strokeWidth={1.5} aria-hidden />
              Επιλογή αρχείου
            </Button>
            <Button type="button" variant="secondary" className="min-h-11 gap-2" onClick={() => cameraInput.current?.click()}>
              <Camera className="h-5 w-5" strokeWidth={1.5} aria-hidden />
              Φωτογραφία
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3 border-y border-hairline py-4">
          <div className="flex items-center gap-3">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center border border-hairline text-muted">
              <KindIcon className="h-6 w-6" strokeWidth={1.5} aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-body text-ink">{file.name}</div>
              <div className="text-small text-muted">
                {meta.title} · {formatSize(file.size)}
              </div>
            </div>
            <button
              type="button"
              onClick={() => void choose(null)}
              disabled={pending}
              className="flex h-11 w-11 items-center justify-center text-muted hover:bg-hover hover:text-ink"
              aria-label="Αφαίρεση αρχείου"
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          </div>
          <p className="text-small text-muted">{meta.text}</p>

          {/* A workbook can be either; the guess is shown and can be corrected. */}
          {kind !== "document" && (
            <fieldset className="flex flex-wrap gap-x-4 gap-y-1 text-body">
              <legend className="sr-only">Είδος αρχείου</legend>
              {(["bank", "aade"] as const).map((k) => (
                <label key={k} className="inline-flex min-h-10 items-center gap-2 text-text">
                  <input type="radio" name="capture_kind" checked={kind === k} onChange={() => setKind(k)} />
                  {KIND_META[k].title}
                </label>
              ))}
            </fieldset>
          )}

          {kind === "bank" && (
            <Select value={accountId} onChange={(e) => setAccountId(e.target.value)} className="sm:w-72" aria-label="Λογαριασμός">
              <option value="" disabled>
                Λογαριασμός αντιγράφου…
              </option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                </option>
              ))}
            </Select>
          )}
          {kind === "aade" && afmMissing && (
            <p className="border-l-2 border-warning pl-3 text-body text-warning">
              Ορίστε πρώτα το πραγματικό ΑΦΜ της επιχείρησης στις Ρυθμίσεις — χρειάζεται για την κατεύθυνση κάθε κίνησης.
            </p>
          )}

          <Button type="button" onClick={submit} disabled={pending} className="w-full py-3 text-body">
            {kind === "document" && <AiSpark className="mr-1.5" />}
            {pending
              ? kind === "document"
                ? "Ανάλυση παραστατικού… (μπορεί να πάρει ως 30 δευτερόλεπτα)"
                : "Ανάγνωση…"
              : kind === "document"
                ? "Ανάλυση με AI"
                : "Ανέβασμα για έλεγχο"}
          </Button>
        </div>
      )}

      {error && (
        <p role="alert" className="border-l-2 border-negative pl-3 text-body text-negative">
          {error}
        </p>
      )}
    </div>
  );
}
