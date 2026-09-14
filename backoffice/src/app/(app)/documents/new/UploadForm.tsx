"use client";

import { useState } from "react";
import { uploadDocument } from "../actions";
import { SubmitButton } from "@/components/SubmitButton";

export function UploadForm() {
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      action={async (formData) => {
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
      className="flex flex-col gap-3 rounded border border-line bg-surface p-4"
    >
      <input
        type="file"
        name="file"
        accept="image/*,.pdf"
        capture="environment"
        required
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file && file.type.startsWith("image/")) {
            setPreview(URL.createObjectURL(file));
          } else {
            setPreview(null);
          }
        }}
        className="text-sm"
      />
      {preview && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={preview} alt="Προεπισκόπηση" className="max-h-80 rounded border border-line object-contain" />
      )}
      {error && <p className="text-sm text-red-ink">{error}</p>}
      <SubmitButton pendingLabel="Ανάλυση παραστατικού… (μπορεί να πάρει ως 30 δευτερόλεπτα)">
        Ανάλυση με AI
      </SubmitButton>
    </form>
  );
}
