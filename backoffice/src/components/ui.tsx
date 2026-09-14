import { type ButtonHTMLAttributes, type InputHTMLAttributes, type SelectHTMLAttributes } from "react";

export function Button({
  variant = "primary",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "danger" }) {
  const base = "rounded-md px-3 py-2 text-sm font-medium transition-colors disabled:opacity-50";
  const variants = {
    primary: "bg-ink text-white hover:bg-ink/85",
    secondary: "border border-line-strong text-ink hover:bg-bg",
    danger: "bg-red-ink text-white hover:bg-red-ink/85",
  };
  return <button className={`${base} ${variants[variant]} ${className}`} {...props} />;
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
    <label className={`mb-1 block text-xs font-medium text-ink-muted ${className}`} title={title}>
      {children}
    </label>
  );
}

export function Field({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-col">{children}</div>;
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
  tone?: "neutral" | "green" | "amber" | "red";
}) {
  const tones = {
    neutral: "bg-bg text-ink-muted",
    green: "bg-sage text-sage-ink",
    amber: "bg-amber-bg text-amber-ink",
    red: "bg-red-bg text-red-ink",
  };
  return (
    <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${tones[tone]}`}>
      {children}
    </span>
  );
}
