"use client";

import { startTransition, useOptimistic, useRef } from "react";
import { X } from "lucide-react";
import { Input } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";
import { el } from "@/lib/i18n/el";

export interface ChecklistItem {
  id: string;
  body: string;
  done: boolean;
}

// Ticks flip on the current frame (useOptimistic) and settle when the
// server re-renders; new lines are a plain form action.
export function TaskChecklist({
  items,
  canWrite,
  addAction,
  toggleAction,
  deleteAction,
}: {
  items: ChecklistItem[];
  canWrite: boolean;
  addAction: (formData: FormData) => Promise<void>;
  toggleAction: (itemId: string, done: boolean) => Promise<void>;
  deleteAction: (itemId: string) => Promise<void>;
}) {
  const [optimistic, update] = useOptimistic(
    items,
    (current: ChecklistItem[], change: { id: string; done?: boolean; removed?: boolean }) =>
      change.removed
        ? current.filter((i) => i.id !== change.id)
        : current.map((i) => (i.id === change.id ? { ...i, done: change.done ?? i.done } : i)),
  );
  const formRef = useRef<HTMLFormElement>(null);
  const done = optimistic.filter((i) => i.done).length;

  return (
    <div className="flex flex-col gap-2">
      {optimistic.length > 0 && (
        <div className="h-1 overflow-hidden bg-hairline">
          <div className="h-full bg-navy" style={{ width: `${(done / optimistic.length) * 100}%` }} />
        </div>
      )}
      <ul className="flex flex-col">
        {optimistic.map((item) => (
          <li key={item.id} className="group flex min-h-11 items-center gap-3 border-b border-hairline text-sm">
            <input
              type="checkbox"
              checked={item.done}
              disabled={!canWrite}
              onChange={(e) => {
                const next = e.target.checked;
                startTransition(async () => {
                  update({ id: item.id, done: next });
                  await toggleAction(item.id, next);
                });
              }}
              aria-label={item.body}
              className="h-4 w-4 accent-navy"
            />
            <span className={`flex-1 ${item.done ? "text-muted line-through" : "text-ink"}`}>{item.body}</span>
            {canWrite && (
              <button
                type="button"
                aria-label={el.common.delete}
                onClick={() =>
                  startTransition(async () => {
                    update({ id: item.id, removed: true });
                    await deleteAction(item.id);
                  })
                }
                className="inline-flex min-h-11 min-w-11 items-center justify-center text-muted hover:bg-hover hover:text-negative focus:opacity-100 md:opacity-0 md:group-hover:opacity-100"
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            )}
          </li>
        ))}
      </ul>
      {canWrite && (
        <form
          ref={formRef}
          action={async (formData) => {
            await addAction(formData);
            formRef.current?.reset();
          }}
          className="flex gap-2"
        >
          <Input name="body" placeholder={el.planner.task.newItem} required maxLength={500} className="flex-1" />
          <SubmitButton variant="secondary">{el.planner.task.addItem}</SubmitButton>
        </form>
      )}
    </div>
  );
}
