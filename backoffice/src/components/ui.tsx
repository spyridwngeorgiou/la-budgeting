import { type ButtonHTMLAttributes, type InputHTMLAttributes, type SelectHTMLAttributes } from "react";

export function Button({
  variant = "primary",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "danger" | "ai" }) {
  const base = "rounded-md px-3 py-2 text-sm font-medium transition-colors disabled:opacity-50";
  const variants = {
    primary: "bg-ink text-white hover:bg-ink/85",
    secondary: "border border-line-strong text-ink hover:bg-bg",
    danger: "bg-red-ink text-white hover:bg-red-ink/85",
    // Every AI-triggered action (generate a summary, run a health check, ask
    // the assistant) uses this same violet treatment, so it reads as "this
    // button calls the AI" on sight, consistently across the whole app.
    ai: "border border-ai-border bg-ai-bg text-ai-ink hover:bg-ai-border/40",
  };
  return <button className={`${base} ${variants[variant]} ${className}`} {...props} />;
}

// Small consistent glyph prefixed onto every AI-triggered label/heading --
// the one visual cue tying chat, Kansha Entry, suggestions and insight
// panels together as "the same feature family" instead of four unrelated
// bits of UI that all happen to call Claude.
export function AiSpark({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" className={`inline-block h-3.5 w-3.5 ${className}`} aria-hidden="true">
      <path d="M8 0c.3 2.7 1.1 4.5 2.4 5.6C11.5 6.9 13.3 7.7 16 8c-2.7.3-4.5 1.1-5.6 2.4C9.1 11.5 8.3 13.3 8 16c-.3-2.7-1.1-4.5-2.4-5.6C4.5 9.1 2.7 8.3 0 8c2.7-.3 4.5-1.1 5.6-2.4C6.9 4.5 7.7 2.7 8 0z" />
    </svg>
  );
}

export function Input({ className = "", ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={`rounded-md border border-line-strong bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-sage-strong focus:outline-none ${className}`}
      {...props}
    />
  );
}

export function Select({
  className = "",
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={`rounded-md border border-line-strong bg-surface px-3 py-2 text-sm text-ink focus:border-sage-strong focus:outline-none ${className}`}
      {...props}
    >
      {children}
    </select>
  );
}

export function Label({
  children,
  className = "",
  title,
}: {
  children: React.ReactNode;
  className?: string;
  title?: string;
}) {
  return (
    <label
      className={`mb-1 block text-xs font-medium text-ink-muted ${title ? "cursor-help underline decoration-dotted underline-offset-2" : ""} ${className}`}
      title={title}
    >
      {children}
    </label>
  );
}

export function Field({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-col">{children}</div>;
}

// Inline definition-on-hover for jargon/acronyms (DSCR, ADR, opex, ...) that
// show up as plain text outside a form Label -- same dotted-underline
// affordance as Label's own `title` prop, just for prose/summary lines.
export function Term({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <span title={title} className="cursor-help underline decoration-dotted underline-offset-2">
      {children}
    </span>
  );
}

export function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-lg border border-line bg-surface p-4 ${className}`}>{children}</div>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-line ${className}`} />;
}

// Generic per-route loading state: a title bar, a filter-row-shaped bar, and
// a handful of table-row-shaped bars. Close enough to every page's real
// layout that it doesn't "pop" jarringly once real content arrives, without
// needing a bespoke skeleton per route.
export function PageSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-4">
      <Skeleton className="h-7 w-48" />
      <Skeleton className="h-10 w-full max-w-md" />
      <div className="flex flex-col gap-2 rounded border border-line p-3">
        {Array.from({ length: rows }).map((_, i) => (
          <Skeleton key={i} className="h-6 w-full" />
        ))}
      </div>
    </div>
  );
}

export function Badge({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "neutral" | "green" | "amber" | "red" | "ai";
}) {
  const tones = {
    neutral: "bg-bg text-ink-muted",
    green: "bg-sage text-sage-ink",
    amber: "bg-amber-bg text-amber-ink",
    red: "bg-red-bg text-red-ink",
    ai: "bg-ai-bg text-ai-ink",
  };
  return (
    <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${tones[tone]}`}>
      {children}
    </span>
  );
}
