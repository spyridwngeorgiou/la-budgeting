import { el } from "@/lib/i18n/el";
import type { TaskPriority, TaskStatus } from "@/lib/domain/enums";
import type { CalendarItem, CalendarSource } from "@/lib/planner/calendar";

// Shared look of planner entities, so the board, the timeline and the
// calendar colour the same thing the same way.

// Status as a dot (one of the two places circles are allowed).
export const STATUS_DOT: Record<TaskStatus, string> = {
  todo: "bg-chip-border",
  in_progress: "bg-warning",
  waiting: "bg-accent-ink",
  review: "bg-navy",
  done: "bg-positive",
};

// Timeline bars: flat token fills, lighter while not yet done.
export const STATUS_BAR: Record<TaskStatus, string> = {
  todo: "bg-chip-border",
  in_progress: "bg-warning/70",
  waiting: "bg-accent-ink/60",
  review: "bg-navy",
  done: "bg-positive/60",
};

export const PRIORITY_TONE: Record<TaskPriority, "warning" | "negative" | null> = {
  low: null,
  normal: null,
  high: "warning",
  urgent: "negative",
};

// Calendar entries: plain text on the field colour with a 2px left bar
// naming the family (the design system's severity bar, never a fill).
export const SOURCE_PILL: Record<CalendarSource, string> = {
  task: "border-chip-border text-ink",
  milestone: "border-navy text-ink",
  phase: "border-accent-ink text-ink",
  project: "border-hairline text-muted",
  payment: "border-warning text-ink",
  installment: "border-warning text-ink",
  vat: "border-negative text-ink",
  withholding: "border-negative text-ink",
  lease: "border-hairline text-muted",
  loan: "border-warning text-ink",
};

// «ΦΠΑ 09/2026», «Άνοιγμα · Έργο A», or just the task title.
export function calendarItemLabel(item: CalendarItem): string {
  const sub = item.subkind ? (el.planner.subkind as Record<string, string>)[item.subkind] : undefined;
  switch (item.source) {
    case "vat":
    case "withholding":
      return `${el.planner.source[item.source]} ${item.title}`;
    case "project":
    case "lease":
      return sub ? `${sub} · ${item.title}` : item.title;
    case "loan":
      return sub ? `${item.title} · ${sub}` : item.title;
    case "installment":
      return `${el.planner.source.installment}: ${item.title}`;
    default:
      return item.title || el.planner.source[item.source];
  }
}

export function initials(label: string): string {
  const parts = label.replace(/@.*/, "").split(/[\s._-]+/).filter(Boolean);
  return (parts[0]?.[0] ?? "?").toUpperCase() + (parts[1]?.[0] ?? "").toUpperCase();
}
