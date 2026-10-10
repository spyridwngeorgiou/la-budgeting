import type { ReactNode } from "react";
import { cn } from "./cn";

// Tones: the old names (green/amber/red) still work and mean the new
// semantic ones (positive/warning/negative).
export type Tone = "neutral" | "positive" | "warning" | "negative" | "ai" | "navy" | "green" | "amber" | "red";

const NORMAL: Record<Tone, Exclude<Tone, "green" | "amber" | "red">> = {
  neutral: "neutral",
  positive: "positive",
  warning: "warning",
  negative: "negative",
  ai: "ai",
  navy: "navy",
  green: "positive",
  amber: "warning",
  red: "negative",
};

const BADGE: Record<Exclude<Tone, "green" | "amber" | "red">, string> = {
  neutral: "border-hairline text-muted",
  positive: "border-transparent bg-positive-tint text-positive",
  warning: "border-transparent bg-warning-tint text-warning",
  negative: "border-transparent bg-negative-tint text-negative",
  ai: "border-transparent bg-ai-tint text-ai",
  navy: "border-navy bg-navy text-panel-ink",
};

export function Badge({ children, tone = "neutral", className = "" }: { children: ReactNode; tone?: Tone; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1 border px-1.5 py-0.5 text-xs font-medium whitespace-nowrap", BADGE[NORMAL[tone]], className)}>
      {children}
    </span>
  );
}

const DOT: Record<Exclude<Tone, "green" | "amber" | "red">, string> = {
  neutral: "bg-chip-border",
  positive: "bg-positive",
  warning: "bg-warning",
  negative: "bg-negative",
  ai: "bg-ai",
  navy: "bg-navy",
};

// A status as a small circle (one of the two places circles are allowed),
// always with a text label -- visible, or for screen readers only.
export function StatusDot({
  tone = "neutral",
  label,
  showLabel = true,
  className = "",
}: {
  tone?: Tone;
  label: string;
  showLabel?: boolean;
  className?: string;
}) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-small text-text", className)}>
      <span aria-hidden="true" className={cn("h-2 w-2 shrink-0 rounded-full", DOT[NORMAL[tone]])} />
      <span className={showLabel ? undefined : "sr-only"}>{label}</span>
    </span>
  );
}
