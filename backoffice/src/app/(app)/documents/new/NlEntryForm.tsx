"use client";

import { useEffect, useRef, useState } from "react";
import { submitNlEntry } from "../actions";
import { SubmitButton } from "@/components/SubmitButton";
import { AiSpark, Button, Notice } from "@/components/ui";
import { errorOf } from "@/lib/actions";

// Minimal ambient typing for the Web Speech API -- not in lib.dom.d.ts, and
// only Chromium/Safari implement it (feature-detected below, never assumed).
interface SpeechRecognitionResult {
  transcript: string;
}
interface SpeechRecognitionEvent {
  results: { [key: number]: { [key: number]: SpeechRecognitionResult } };
}
interface SpeechRecognitionLike extends EventTarget {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
}

export function NlEntryForm({ rows = 3 }: { rows?: number }) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [listening, setListening] = useState(false);
  const [micSupported, setMicSupported] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

  useEffect(() => {
    const w = window as unknown as {
      webkitSpeechRecognition?: new () => SpeechRecognitionLike;
      SpeechRecognition?: new () => SpeechRecognitionLike;
    };
    const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (Ctor) {
      // Browser-only feature detection: must run after hydration, or the
      // server-rendered (mic hidden) markup would mismatch the client's.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setMicSupported(true);
      const recognition = new Ctor();
      recognition.lang = "el-GR";
      recognition.interimResults = false;
      recognition.continuous = false;
      recognitionRef.current = recognition;
    }
  }, []);

  const toggleMic = () => {
    const recognition = recognitionRef.current;
    if (!recognition) return;
    if (listening) {
      recognition.stop();
      return;
    }
    recognition.onresult = (event) => {
      const transcript = event.results[0][0].transcript;
      setText((prev) => (prev ? `${prev} ${transcript}` : transcript));
    };
    recognition.onend = () => setListening(false);
    recognition.onerror = () => setListening(false);
    recognition.start();
    setListening(true);
  };

  return (
    <form
      action={async (formData) => {
        setError(null);
        const message = errorOf(await submitNlEntry(formData));
        if (message) setError(message);
      }}
      className="flex flex-col gap-3"
    >
      <div className="flex items-start gap-2">
        <textarea
          name="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="π.χ. Πλήρευσα 80 ευρώ στον υδραυλικό για το Q003, μετρητά, χωρίς απόδειξη. Μπορείτε να περιγράψετε περισσότερες από μία κινήσεις μαζί -- θα καταχωρηθούν ξεχωριστά."
          rows={rows}
          required
          className="min-w-0 flex-1 border border-field-border bg-field px-3 py-2 text-body text-ink placeholder:text-muted focus:border-navy focus:outline-none"
        />
        {micSupported && (
          <Button
            type="button"
            variant={listening ? "danger" : "secondary"}
            onClick={toggleMic}
            title={listening ? "Διακοπή εγγραφής" : "Υπαγόρευση με φωνή"}
          >
            {listening ? "■" : "🎤"}
          </Button>
        )}
      </div>
      {error && (
        <Notice tone="negative" role="alert">
          {error}
        </Notice>
      )}
      <SubmitButton variant={text.trim() ? "aiSolid" : "ai"} className="w-full py-3 text-body" pendingLabel="Ανάλυση περιγραφής…" disabled={!text.trim()}>
        <AiSpark className="mr-1.5" />
        Ανάλυση με AI
      </SubmitButton>
    </form>
  );
}
