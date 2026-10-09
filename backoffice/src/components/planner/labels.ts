import { el } from "@/lib/i18n/el";
import type { TaskPriority, TaskStatus } from "@/lib/domain/enums";
import type { CalendarItem, CalendarSource } from "@/lib/planner/calendar";

// Shared look of planner entities, so the board, the timeline and the
// calendar colour the same thing the same way.

export const STATUS_DOT: Record<TaskStatus, string> = {
  todo: "bg-line-strong",
  in_progress: "bg-amber-ink",
  waiting: "bg-ai-strong",
  review: "bg-sage-strong",
  done: "bg-sage-ink",
};

export const STATUS_BAR: Record<TaskStatus, string> = {
  todo: "bg-line-strong",
  in_progress: "bg-amber-ink/70",
  waiting: "bg-ai-strong/60",
  review: "bg-sage-strong",
  done: "bg-sage-ink/60",
};

export const PRIORITY_TONE: Record<TaskPriority, "neutral" | "amber" | "red" | null> = {
  low: null,
  normal: null,
  high: "amber",
  urgent: "red",
};

export const SOURCE_PILL: Record<CalendarSource, string> = {
  task: "border-line-strong bg-surface text-ink",
  milestone: "border-sage-strong bg-sage text-sage-ink",
  phase: "border-sage-strong bg-surface text-sage-ink",
  project: "border-line bg-bg text-ink-muted",
  payment: "border-amber-ink/30 bg-amber-bg text-amber-ink",
  installment: "border-amber-ink/30 bg-amber-bg text-amber-ink",
  vat: "border-red-ink/30 bg-red-bg text-red-ink",
  withholding: "border-red-ink/30 bg-red-bg text-red-ink",
  lease: "border-line bg-bg text-ink-muted",
  loan: "border-amber-ink/30 bg-amber-bg text-amber-ink",
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
