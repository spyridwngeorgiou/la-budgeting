"use client";

import { useEffect, useRef, useState } from "react";
import { submitNlEntry } from "../actions";
import { SubmitButton } from "@/components/SubmitButton";
import { Button, AiSpark } from "@/components/ui";

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

export function NlEntryForm() {
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
        try {
          await submitNlEntry(formData);
        } catch (e) {
          if (e instanceof Error && !e.message.includes("NEXT_REDIRECT")) setError(e.message);
          else if (!(e instanceof Error)) setError("Σφάλμα.");
          else throw e;
        }
      }}
      className="flex flex-col gap-3 rounded border border-line bg-surface p-4"
    >
      <div className="flex items-start gap-2">
        <textarea
          name="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="π.χ. Πλήρευσα 80 ευρώ στον υδραυλικό για το Q003, μετρητά, χωρίς απόδειξη. Μπορείτε να περιγράψετε περισσότερες από μία κινήσεις μαζί -- θα καταχωρηθούν ξεχωριστά."
          rows={3}
          required
          className="flex-1 rounded-md border border-line-strong bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-sage-strong focus:outline-none"
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
      {error && <p className="text-sm text-red-ink">{error}</p>}
      <SubmitButton variant="ai" pendingLabel="Ανάλυση περιγραφής…" disabled={!text.trim()}>
        <AiSpark className="mr-1.5" />
        Ανάλυση με AI
      </SubmitButton>
    </form>
  );
}
