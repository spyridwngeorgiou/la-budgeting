"use client";

import { useRef, useState, type KeyboardEvent } from "react";
import { activeMention, insertMention, matchPeople, mentionSegments, type MentionPerson } from "@/lib/collab/mentions";

// A textarea that suggests project people after "@" (comments, team chat).
// Mentions are plain text ("@Μαρία Παπά"); MentionText highlights them when
// shown. `submitOn`: "enter" sends on Enter (Shift+Enter = new line, the
// chat convention); "mod-enter" sends on Ctrl/Cmd+Enter (comments).
export function MentionTextarea({
  value,
  onChange,
  onSubmit,
  people,
  extraSuggestions = [],
  placeholder,
  rows = 2,
  maxLength = 4000,
  className = "",
  submitOn = "enter",
  disabled,
  autoFocus,
  ariaLabel,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  people: MentionPerson[];
  // Pseudo-people offered first, e.g. the assistant in team chat.
  extraSuggestions?: MentionPerson[];
  placeholder?: string;
  rows?: number;
  maxLength?: number;
  className?: string;
  submitOn?: "enter" | "mod-enter";
  disabled?: boolean;
  autoFocus?: boolean;
  ariaLabel?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [caret, setCaret] = useState(0);
  const [active, setActive] = useState(0);
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);

  const mention = activeMention(value, caret);
  const suggestions =
    mention && dismissedAt !== mention.start ? matchPeople([...extraSuggestions, ...people], mention.query) : [];
  const open = suggestions.length > 0;
  const highlighted = Math.min(active, Math.max(0, suggestions.length - 1));

  function pick(p: MentionPerson) {
    if (!mention) return;
    const next = insertMention(value, mention.start, caret, p.name);
    onChange(next.text);
    setCaret(next.caret);
    setActive(0);
    window.requestAnimationFrame(() => {
      ref.current?.focus();
      ref.current?.setSelectionRange(next.caret, next.caret);
    });
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (open) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const d = e.key === "ArrowDown" ? 1 : -1;
        setActive((highlighted + d + suggestions.length) % suggestions.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        pick(suggestions[highlighted]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        if (mention) setDismissedAt(mention.start);
        return;
      }
    }
    const isSubmit =
      e.key === "Enter" && (submitOn === "enter" ? !e.shiftKey && !e.nativeEvent.isComposing : e.metaKey || e.ctrlKey);
    if (isSubmit) {
      e.preventDefault();
      onSubmit();
    }
  }

  return (
    <div className="relative min-w-0 flex-1">
      {open && (
        <ul
          role="listbox"
          className="absolute bottom-full left-0 z-30 mb-1 max-h-56 w-64 max-w-full overflow-y-auto rounded-lg border border-line bg-surface py-1 shadow-lg"
        >
          {suggestions.map((p, i) => (
            <li key={p.userId} role="option" aria-selected={i === highlighted}>
              <button
                type="button"
                className={`flex min-h-11 w-full items-center px-3 text-left text-sm ${i === highlighted ? "bg-sage/50" : "hover:bg-bg"}`}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(p)}
              >
                @{p.name}
              </button>
            </li>
          ))}
        </ul>
      )}
      <textarea
        ref={ref}
        value={value}
        rows={rows}
        maxLength={maxLength}
        placeholder={placeholder}
        disabled={disabled}
        autoFocus={autoFocus}
        aria-label={ariaLabel ?? placeholder}
        className={`block w-full resize-none rounded-lg border border-line-strong bg-surface px-3 py-2 text-base focus:border-sage-strong focus:outline-none sm:text-sm ${className}`}
        onChange={(e) => {
          onChange(e.target.value);
          setCaret(e.target.selectionStart ?? e.target.value.length);
          setDismissedAt(null);
        }}
        onSelect={(e) => setCaret(e.currentTarget.selectionStart ?? 0)}
        onKeyDown={onKeyDown}
      />
    </div>
  );
}

// Body text with @mentions of known people highlighted.
export function MentionText({ body, names }: { body: string; names: string[] }) {
  return (
    <>
      {mentionSegments(body, names).map((s, i) =>
        s.mention ? (
          <span key={i} className="rounded bg-sage/60 px-0.5 font-medium text-sage-ink">
            {s.text}
          </span>
        ) : (
          <span key={i}>{s.text}</span>
        ),
      )}
    </>
  );
}
