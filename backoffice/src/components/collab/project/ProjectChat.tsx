"use client";

import { useMemo, useState } from "react";
import { el } from "@/lib/i18n/el";
import { createClient } from "@/lib/supabase/client";
import { TeamChat } from "../TeamChat";
import { useTeamChat } from "../useTeamChat";
import { ToastStack, useConfirm, useToasts } from "../feedback";

// The big «Συζήτηση ομάδας» entry on the project page, with an unread badge,
// opening the team chat in a drawer (bottom sheet on phones). The assistant
// lives on boards, so "@βοηθός" here just posts to the team.
export function ProjectChat({
  projectId,
  orgId,
  meId,
  people,
  canUpload,
  canManage,
  boardTitles,
}: {
  projectId: string;
  orgId: string;
  meId: string;
  people: Record<string, string>;
  canUpload: boolean;
  canManage: boolean;
  boardTitles: Record<string, string>;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [open, setOpen] = useState(false);
  const chat = useTeamChat({ supabase, projectId, orgId, meId, active: open });
  const { toasts, push, dismiss } = useToasts();
  const { confirm, dialog } = useConfirm();
  const last = chat.messages[chat.messages.length - 1];

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="relative flex min-h-16 w-full items-center gap-3 rounded-xl bg-sage-strong px-4 py-3 text-left shadow-sm hover:bg-sage"
      >
        <span className="text-2xl" aria-hidden="true">
          💬
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-base font-semibold">{el.collab.project.chatCta}</span>
          <span className="block truncate text-xs text-ink-muted">
            {last ? `${(last.author_id && people[last.author_id]) || el.collab.unknownUser}: ${last.body}` : el.collab.project.chatCtaHint}
          </span>
        </span>
        {chat.unread > 0 && (
          <span className="flex h-7 min-w-7 items-center justify-center rounded-full bg-red-ink px-2 text-sm font-bold text-white">
            {chat.unread > 99 ? "99+" : chat.unread}
            <span className="sr-only"> {el.collab.chat.unread}</span>
          </span>
        )}
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex justify-end bg-ink/20" onClick={() => setOpen(false)} role="presentation">
          <aside
            role="dialog"
            aria-modal="true"
            aria-label={el.collab.chat.title}
            className="flex w-full flex-col bg-surface shadow-2xl max-md:absolute max-md:inset-x-0 max-md:bottom-0 max-md:h-[85dvh] max-md:rounded-t-2xl md:h-full md:max-w-md"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-line px-3 py-1.5">
              <h2 className="text-base font-semibold">👥 {el.collab.chat.title}</h2>
              <button
                type="button"
                className="flex h-11 w-11 items-center justify-center rounded-lg text-xl text-ink-muted hover:bg-bg"
                onClick={() => setOpen(false)}
                aria-label={el.collab.comments.close}
              >
                ×
              </button>
            </div>
            <TeamChat
              chat={chat}
              projectId={projectId}
              boardId={null}
              meId={meId}
              people={people}
              canUpload={canUpload}
              canManage={canManage}
              onToast={(message, tone) => push({ message, tone })}
              confirm={confirm}
              boardTitles={boardTitles}
            />
          </aside>
        </div>
      )}
      {dialog}
      <ToastStack toasts={toasts} onDismiss={dismiss} className="fixed inset-x-0 bottom-4 z-[70] px-2" />
    </>
  );
}
