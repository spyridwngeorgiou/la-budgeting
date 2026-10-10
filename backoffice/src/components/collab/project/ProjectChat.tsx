"use client";

import { useMemo, useState } from "react";
import { el } from "@/lib/i18n/el";
import { createClient } from "@/lib/supabase/client";
import { Badge, SectionHeader } from "@/components/ui";
import { TeamChat } from "../TeamChat";
import { useTeamChat } from "../useTeamChat";
import { ToastStack, useConfirm, useToasts } from "../feedback";

// The «Συζήτηση ομάδας» entry on the project page, with an unread badge,
// opening the team chat in a drawer (full screen on phones). The assistant
// lives on boards, so "@βοηθός" here just posts to the team.
//
// The drawer is a plain fixed panel with ui/Drawer's look rather than
// ui/Drawer itself: that one is a native <dialog> in the top layer, which
// would sit above (and make inert) the confirm dialog and the toasts from
// ../feedback that the chat relies on.
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
    <section className="flex flex-col">
      <SectionHeader title={el.collab.project.chatCta} />
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex min-h-16 w-full items-center gap-4 border-b border-hairline px-1 py-3 text-left transition-colors hover:bg-hover"
      >
        <span className="min-w-0 flex-1">
          <span className="sr-only">{el.collab.project.chatCta}: </span>
          <span className="block truncate text-sm text-text">
            {last ? (
              <>
                <span className="text-ink">{(last.author_id && people[last.author_id]) || el.collab.unknownUser}</span>
                <span className="text-muted">: </span>
                {last.body}
              </>
            ) : (
              <span className="text-muted">{el.collab.project.chatCtaHint}</span>
            )}
          </span>
        </span>
        {chat.unread > 0 && (
          <Badge tone="navy" className="num">
            {chat.unread > 99 ? "99+" : chat.unread}
            <span className="sr-only"> {el.collab.chat.unread}</span>
          </Badge>
        )}
        <span aria-hidden="true" className="shrink-0 text-small text-muted">
          {el.collab.project.openBoard} →
        </span>
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex justify-end bg-ink/30" onClick={() => setOpen(false)} role="presentation">
          <aside
            role="dialog"
            aria-modal="true"
            aria-label={el.collab.chat.title}
            className="flex h-dvh w-full flex-col bg-raised text-ink md:w-drawer md:border-l md:border-hairline"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-4 border-b border-rule px-4 py-3 md:px-6">
              <h2 className="text-section font-normal text-ink">{el.collab.chat.title}</h2>
              <button
                type="button"
                className="-mr-2 inline-flex min-h-11 min-w-11 items-center justify-center text-xl text-muted hover:bg-hover hover:text-ink"
                onClick={() => setOpen(false)}
                aria-label={el.collab.comments.close}
              >
                <span aria-hidden="true">×</span>
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
    </section>
  );
}
