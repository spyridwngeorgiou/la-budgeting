"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";
import { countUnread, lastReadStorageKey, projectTopic, upsertMessage } from "@/lib/collab/chat";
import { uploadBoardFile } from "./boardFiles";

// The project's team chat (project_messages, 0060): initial load, live
// updates over the private Realtime topic "project:<uuid>" (fed only by the
// database trigger -- clients can't broadcast there), unread tracking per
// browser, and send / edit / delete under the caller's RLS.
//
// Lives above the panel (in BoardCanvas or the project page) so the unread
// badge keeps counting while the chat is closed.

export interface TeamMessage {
  id: string;
  author_id: string | null;
  board_id: string | null;
  body: string;
  attachment_ids: string[];
  created_at: string;
  edited_at: string | null;
}

export interface AttachmentInfo {
  id: string;
  name: string;
  mimeType: string;
}

const COLUMNS = "id, author_id, board_id, body, attachment_ids, created_at, edited_at" as const;
const PAGE = 100;

function readLastRead(projectId: string): string | null {
  try {
    return window.localStorage.getItem(lastReadStorageKey(projectId));
  } catch {
    return null;
  }
}

function writeLastRead(projectId: string, iso: string) {
  try {
    window.localStorage.setItem(lastReadStorageKey(projectId), iso);
  } catch {
    // Private mode / storage full: unread counts just reset next visit.
  }
}

export function useTeamChat({
  supabase,
  projectId,
  orgId,
  meId,
  active,
}: {
  supabase: SupabaseClient<Database>;
  projectId: string;
  orgId: string;
  meId: string;
  // The team tab is visible: everything shown counts as read.
  active: boolean;
}) {
  const [messages, setMessages] = useState<TeamMessage[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [lastRead, setLastRead] = useState<string | null>(() =>
    typeof window === "undefined" ? null : readLastRead(projectId),
  );
  const [attachments, setAttachments] = useState<Record<string, AttachmentInfo | null>>({});

  const reload = useCallback(async () => {
    const { data } = await supabase
      .from("project_messages")
      .select(COLUMNS)
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .limit(PAGE);
    if (data) setMessages([...data].reverse());
    setLoaded(true);
  }, [supabase, projectId]);

  // Initial load + live channel. Every re-subscribe reloads, since events
  // sent while we were away are gone.
  useEffect(() => {
    let cancelled = false;
    let channel: RealtimeChannel | null = null;
    let everSubscribed = false;

    const onRow = (kind: "insert" | "update" | "delete", payload: unknown) => {
      const p = (payload ?? {}) as Record<string, unknown>;
      const record = (p.record ?? p.new ?? null) as TeamMessage | null;
      const old = (p.old_record ?? p.old ?? null) as { id?: string } | null;
      if (kind === "delete") {
        if (old?.id) setMessages((list) => list.filter((m) => m.id !== old.id));
        return;
      }
      if (record && (record as unknown as { project_id?: string }).project_id === projectId) {
        setMessages((list) => upsertMessage(list, { ...record, attachment_ids: record.attachment_ids ?? [] }));
      }
    };

    void (async () => {
      await reload();
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (session) await supabase.realtime.setAuth(session.access_token);
      if (cancelled) return;
      channel = supabase.channel(projectTopic(projectId), { config: { private: true } });
      channel
        .on("broadcast", { event: "message_insert" }, ({ payload }) => onRow("insert", payload))
        .on("broadcast", { event: "message_update" }, ({ payload }) => onRow("update", payload))
        .on("broadcast", { event: "message_delete" }, ({ payload }) => onRow("delete", payload))
        .subscribe((status) => {
          if (status === "SUBSCRIBED") {
            if (everSubscribed) void reload();
            everSubscribed = true;
          }
        });
    })();

    return () => {
      cancelled = true;
      if (channel) void supabase.removeChannel(channel);
    };
  }, [supabase, projectId, reload]);

  // Attachment names/types for whatever the visible messages reference.
  const wantedAttachments = useMemo(
    () => [...new Set(messages.flatMap((m) => m.attachment_ids))].filter((id) => !(id in attachments)),
    [messages, attachments],
  );
  useEffect(() => {
    if (wantedAttachments.length === 0) return;
    let cancelled = false;
    void supabase
      .from("board_files")
      .select("id, original_name, mime_type")
      .in("id", wantedAttachments)
      .then(({ data, error }) => {
        if (cancelled || error) return;
        setAttachments((prev) => {
          const next = { ...prev };
          for (const id of wantedAttachments) next[id] = null; // deleted / not visible
          for (const f of data ?? []) next[f.id] = { id: f.id, name: f.original_name ?? "", mimeType: f.mime_type };
          return next;
        });
      });
    return () => {
      cancelled = true;
    };
  }, [supabase, wantedAttachments]);

  const latest = messages.length > 0 ? messages[messages.length - 1].created_at : null;
  const unread = active ? 0 : countUnread(messages, lastRead, meId);

  // Mark as read while the tab is open (and whenever a new message arrives
  // while it is). Deferred so it never sets state synchronously in render.
  useEffect(() => {
    if (!active || !latest) return;
    if (lastRead && lastRead >= latest) return;
    const t = window.setTimeout(() => {
      writeLastRead(projectId, latest);
      setLastRead(latest);
    }, 0);
    return () => window.clearTimeout(t);
  }, [active, latest, lastRead, projectId]);

  const send = useCallback(
    async (
      body: string,
      files: File[],
      boardId: string | null,
      onProgress?: (done: number, total: number) => void,
    ): Promise<boolean> => {
      const ids: string[] = [];
      for (let i = 0; i < files.length; i++) {
        onProgress?.(i, files.length);
        const f = files[i];
        ids.push(
          await uploadBoardFile(supabase, { orgId, projectId, boardId: null }, {
            fileId: crypto.randomUUID(),
            blob: f,
            mimeType: f.type,
            name: f.name,
          }),
        );
      }
      onProgress?.(files.length, files.length);
      const { data, error } = await supabase
        .from("project_messages")
        .insert({
          // org_id is overwritten from the project by trigger.
          org_id: orgId,
          project_id: projectId,
          board_id: boardId,
          body: body.slice(0, 4000),
          attachment_ids: ids,
        })
        .select(COLUMNS)
        .single();
      if (error || !data) return false;
      setMessages((list) => upsertMessage(list, data));
      return true;
    },
    [supabase, orgId, projectId],
  );

  const edit = useCallback(
    async (id: string, body: string) => {
      const { data, error } = await supabase
        .from("project_messages")
        .update({ body: body.slice(0, 4000) })
        .eq("id", id)
        .select(COLUMNS)
        .single();
      if (error || !data) return false;
      setMessages((list) => upsertMessage(list, data));
      return true;
    },
    [supabase],
  );

  const remove = useCallback(
    async (id: string) => {
      const { data, error } = await supabase.from("project_messages").delete().eq("id", id).select("id");
      if (error || !data || data.length === 0) return false;
      setMessages((list) => list.filter((m) => m.id !== id));
      return true;
    },
    [supabase],
  );

  return { messages, loaded, unread, attachments, send, edit, remove };
}

export type TeamChatState = ReturnType<typeof useTeamChat>;
