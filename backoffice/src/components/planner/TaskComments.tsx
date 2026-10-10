"use client";

import { useOptimistic, useRef } from "react";
import { Button, Textarea, cn } from "@/components/ui";
import { el } from "@/lib/i18n/el";

export interface TaskComment {
  id: string;
  author: string;
  body: string;
  created_at: string;
  mine: boolean;
}

const timeFormatter = new Intl.DateTimeFormat("el-GR", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Athens",
});

// Persisted comments come from the server render; the one just sent shows
// faded on the current frame (useOptimistic) until that render arrives --
// the pattern from Next's interactive-apps guide.
export function TaskComments({
  comments,
  canWrite,
  addAction,
  deleteAction,
}: {
  comments: TaskComment[];
  canWrite: boolean;
  addAction: (body: string) => Promise<void>;
  deleteAction: (commentId: string) => Promise<void>;
}) {
  const [pending, addPending] = useOptimistic<TaskComment[], TaskComment>([], (current, c) => [...current, c]);
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col">
        {[...comments, ...pending].map((c) => (
          <li
            key={c.id}
            className={cn("border-b border-hairline py-3", c.mine && "border-l-2 border-l-navy pl-3", c.id.startsWith("pending:") && "opacity-60")}
          >
            <div className="mb-1 flex items-center justify-between gap-2 text-xs text-muted">
              <span className="font-medium text-text">{c.author}</span>
              <span className="num flex items-center gap-2">
                {timeFormatter.format(new Date(c.created_at))}
                {c.mine && !c.id.startsWith("pending:") && (
                  <form action={deleteAction.bind(null, c.id)}>
                    <button type="submit" className="inline-flex min-h-8 items-center px-1 hover:text-negative max-md:min-h-11">
                      {el.common.delete}
                    </button>
                  </form>
                )}
              </span>
            </div>
            <p className="text-sm whitespace-pre-wrap text-ink">{c.body}</p>
          </li>
        ))}
      </ul>
      {canWrite && (
        <form
          ref={formRef}
          action={async (formData) => {
            const body = String(formData.get("body") ?? "").trim();
            if (!body) return;
            formRef.current?.reset();
            addPending({
              id: `pending:${crypto.randomUUID()}`,
              author: "…",
              body,
              created_at: new Date().toISOString(),
              mine: true,
            });
            await addAction(body);
          }}
          className="flex flex-col gap-2"
        >
          <Textarea name="body" rows={2} required placeholder={el.planner.task.newComment} className="min-h-20" />
          <div className="flex justify-end">
            <Button type="submit" variant="secondary">
              {el.planner.task.send}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
