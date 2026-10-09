"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { CaptureUpdateAction, hashElementsVersion, reconcileElements } from "@excalidraw/excalidraw";
import type { Collaborator, ExcalidrawImperativeAPI, SocketId } from "@excalidraw/excalidraw/types";
import type { OrderedExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { RemoteExcalidrawElement } from "@excalidraw/excalidraw/data/reconcile";
import { createClient } from "@/lib/supabase/client";
import { boardTopic } from "@/lib/collab/paths";
import type { Json } from "@/lib/db/types";

// Live sync for one board, over a private Realtime channel "board:<id>"
// (policies in 0038):
//
//  - local edits -> broadcast as element deltas (throttled) so peers see
//    them immediately, and -> upsert_board_elements (debounced), which
//    persists them with Excalidraw's own merge rule and hands back any
//    element where the server copy won;
//  - remote deltas -> reconcileElements() into the local scene;
//  - presence carries who's here and their cursor;
//  - on every *re*-subscribe (network drop, laptop sleep) the scene is
//    reloaded from the database, since broadcasts sent while we were away
//    are gone for good.
//
// Guests never broadcast or save (the policies would refuse anyway); they
// receive, show presence and comment.

export type SyncStatus = "connecting" | "live" | "saving" | "saved" | "offline" | "error";

// Someone else on the board right now, for «Πού είναι οι άλλοι».
export interface Peer {
  userId: string;
  name: string;
  color: string;
  pointer?: { x: number; y: number };
}

export type CommentEvent = {
  kind: "insert" | "update" | "delete";
  record: Record<string, unknown> | null;
  old: Record<string, unknown> | null;
};

const BROADCAST_EVERY_MS = 80;
const SAVE_DEBOUNCE_MS = 700;
const SAVE_MAX_WAIT_MS = 3000;
const RETRY_MS = 4000;
const POINTER_EVERY_MS = 120;
// Supabase Realtime caps a message's payload; stay well under it.
const MAX_BROADCAST_BYTES = 180_000;
// upsert_board_elements caps a call at 2000 elements / 5 MB.
const MAX_SAVE_ELEMENTS = 500;

const CURSOR_COLORS = ["#e03131", "#1971c2", "#2f9e44", "#f08c00", "#9c36b5", "#0c8599", "#c2255c", "#5c940d"];
function colorFor(userId: string) {
  let h = 0;
  for (let i = 0; i < userId.length; i++) h = (h * 31 + userId.charCodeAt(i)) | 0;
  const stroke = CURSOR_COLORS[Math.abs(h) % CURSOR_COLORS.length];
  return { background: `${stroke}33`, stroke };
}

type PresenceMeta = {
  userId: string;
  name: string;
  pointer?: { x: number; y: number; tool: "pointer" | "laser" };
  button?: "up" | "down";
};

function chunkBySize<T>(items: T[], maxBytes: number, maxCount = Infinity): T[][] {
  const chunks: T[][] = [];
  let current: T[] = [];
  let size = 0;
  for (const item of items) {
    const itemSize = JSON.stringify(item).length;
    if (current.length > 0 && (size + itemSize > maxBytes || current.length >= maxCount)) {
      chunks.push(current);
      current = [];
      size = 0;
    }
    current.push(item);
    size += itemSize;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

export function useBoardSync({
  boardId,
  canEdit,
  me,
  initialElements,
  api,
  onRemoteElements,
  onCommentEvent,
  onResync,
}: {
  boardId: string;
  canEdit: boolean;
  me: { userId: string; name: string };
  initialElements: readonly { id: string; version: number }[];
  api: ExcalidrawImperativeAPI | null;
  onRemoteElements?: (elements: readonly OrderedExcalidrawElement[]) => void;
  onCommentEvent: (event: CommentEvent) => void;
  onResync: () => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [status, setStatus] = useState<SyncStatus>("connecting");
  const [peers, setPeers] = useState<Peer[]>([]);
  const peerCount = peers.length;

  // Last version we know the rest of the room has (from the initial load,
  // a remote delta, or our own broadcast). An element whose version is
  // above it is a local change still to be sent. Mutable on purpose: it's
  // bookkeeping read inside event handlers, never rendered.
  const [known] = useState(() => new Map(initialElements.map((e) => [e.id, e.version])));
  const [outbox] = useState(() => new Map<string, OrderedExcalidrawElement>());
  const [pending] = useState(() => new Map<string, OrderedExcalidrawElement>());
  const [presenceKey] = useState(() => `${me.userId}:${Math.random().toString(36).slice(2, 10)}`);

  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const subscribedRef = useRef(false);
  const lastSceneHash = useRef<number | null>(null);
  const timers = useRef<{ broadcast?: number; save?: number; saveMax?: number; pointer?: number }>({});
  const savingRef = useRef(false);
  const lastPointerRef = useRef<PresenceMeta["pointer"] | null>(null);
  const handlersRef = useRef({ onRemoteElements, onCommentEvent, onResync });

  useEffect(() => {
    apiRef.current = api;
  }, [api]);
  useEffect(() => {
    handlersRef.current = { onRemoteElements, onCommentEvent, onResync };
  }, [onRemoteElements, onCommentEvent, onResync]);

  const applyRemote = useCallback(
    (elements: unknown[]) => {
      const a = apiRef.current;
      if (!a || elements.length === 0) return;
      const remote = elements as RemoteExcalidrawElement[];
      const reconciled = reconcileElements(a.getSceneElementsIncludingDeleted(), remote, a.getAppState());
      // Record what the scene actually holds now. If the local copy won
      // (e.g. it's mid-edit), its version is what peers must be told about
      // once it changes again.
      const byId = new Map(reconciled.map((el) => [el.id, el.version]));
      for (const el of remote) known.set(el.id, Math.max(known.get(el.id) ?? -1, byId.get(el.id) ?? el.version));
      a.updateScene({ elements: reconciled, captureUpdate: CaptureUpdateAction.NEVER });
      handlersRef.current.onRemoteElements?.(remote);
    },
    [known],
  );

  const flushBroadcast = useCallback(() => {
    timers.current.broadcast = undefined;
    const channel = channelRef.current;
    if (!channel || !subscribedRef.current || outbox.size === 0) return;
    const elements = [...outbox.values()];
    outbox.clear();
    for (const chunk of chunkBySize(elements, MAX_BROADCAST_BYTES)) {
      void channel.send({ type: "broadcast", event: "elements", payload: { elements: chunk } });
    }
  }, [outbox]);

  // Retries re-enter save() through a ref: a useCallback can't name itself.
  const saveRef = useRef<() => Promise<void>>(() => Promise.resolve());
  const save = useCallback(async () => {
    window.clearTimeout(timers.current.save);
    window.clearTimeout(timers.current.saveMax);
    timers.current.save = timers.current.saveMax = undefined;
    if (savingRef.current || pending.size === 0) return;

    savingRef.current = true;
    setStatus("saving");
    const batch = [...pending.values()];
    pending.clear();
    let failed = false;
    for (const chunk of chunkBySize(batch, 2_000_000, MAX_SAVE_ELEMENTS)) {
      const { data, error } = await supabase.rpc("upsert_board_elements", {
        p_board: boardId,
        p_elements: chunk as unknown as Json,
      });
      if (error) {
        failed = true;
        // Re-queue unless a newer local copy has been queued meanwhile.
        for (const el of chunk) if (!pending.has(el.id)) pending.set(el.id, el);
        continue;
      }
      if (Array.isArray(data) && data.length > 0) applyRemote(data);
    }
    savingRef.current = false;

    if (failed) {
      setStatus(typeof navigator !== "undefined" && !navigator.onLine ? "offline" : "error");
      timers.current.save = window.setTimeout(() => void saveRef.current(), RETRY_MS);
    } else if (pending.size > 0) {
      timers.current.save = window.setTimeout(() => void saveRef.current(), SAVE_DEBOUNCE_MS);
    } else {
      setStatus("saved");
    }
  }, [supabase, boardId, pending, applyRemote]);
  useEffect(() => {
    saveRef.current = save;
  }, [save]);

  const scheduleSave = useCallback(() => {
    window.clearTimeout(timers.current.save);
    timers.current.save = window.setTimeout(() => void save(), SAVE_DEBOUNCE_MS);
    timers.current.saveMax ??= window.setTimeout(() => void save(), SAVE_MAX_WAIT_MS);
  }, [save]);

  // Excalidraw's onChange: fires on every render-worthy change (including
  // pointer moves), so short-circuit on the scene's version hash first.
  const handleChange = useCallback(
    (elements: readonly OrderedExcalidrawElement[]) => {
      if (!canEdit) return;
      const hash = hashElementsVersion(elements);
      if (hash === lastSceneHash.current) return;
      lastSceneHash.current = hash;

      let changed = false;
      for (const el of elements) {
        const k = known.get(el.id);
        if (k === undefined || el.version > k) {
          known.set(el.id, el.version);
          outbox.set(el.id, el);
          pending.set(el.id, el);
          changed = true;
        }
      }
      if (!changed) return;
      timers.current.broadcast ??= window.setTimeout(flushBroadcast, BROADCAST_EVERY_MS);
      scheduleSave();
    },
    [canEdit, known, outbox, pending, flushBroadcast, scheduleSave],
  );

  const trackPresence = useCallback(() => {
    const channel = channelRef.current;
    if (!channel || !subscribedRef.current) return;
    const meta: PresenceMeta = { userId: me.userId, name: me.name, ...(lastPointerRef.current ? { pointer: lastPointerRef.current } : {}) };
    void channel.track(meta);
  }, [me.userId, me.name]);

  const handlePointer = useCallback(
    (payload: { pointer: { x: number; y: number; tool: "pointer" | "laser" }; button: "down" | "up" }) => {
      lastPointerRef.current = payload.pointer;
      timers.current.pointer ??= window.setTimeout(() => {
        timers.current.pointer = undefined;
        trackPresence();
      }, POINTER_EVERY_MS);
    },
    [trackPresence],
  );

  const reloadFromDatabase = useCallback(async () => {
    const { data } = await supabase.from("board_elements").select("data").eq("board_id", boardId);
    if (data) applyRemote(data.map((r) => r.data));
    handlersRef.current.onResync();
  }, [supabase, boardId, applyRemote]);

  useEffect(() => {
    let cancelled = false;
    let everSubscribed = false;
    let channel: RealtimeChannel | null = null;

    const updateCollaborators = () => {
      const a = apiRef.current;
      if (!channel || !a) return;
      const state = channel.presenceState<PresenceMeta>();
      const collaborators = new Map<SocketId, Collaborator>();
      for (const [key, metas] of Object.entries(state)) {
        if (key === presenceKey) continue;
        const meta = metas[metas.length - 1];
        if (!meta) continue;
        collaborators.set(key as SocketId, {
          id: meta.userId,
          socketId: key as SocketId,
          username: meta.name,
          pointer: meta.pointer,
          button: meta.button,
          color: colorFor(meta.userId),
        });
      }
      // One entry per person (several tabs collapse into the latest).
      const byUser = new Map<string, Peer>();
      for (const c of collaborators.values()) {
        if (!c.id) continue;
        byUser.set(c.id, {
          userId: c.id,
          name: c.username ?? "",
          color: c.color?.stroke ?? "#868e96",
          pointer: c.pointer ? { x: c.pointer.x, y: c.pointer.y } : undefined,
        });
      }
      setPeers([...byUser.values()]);
      a.updateScene({ collaborators });
    };

    void (async () => {
      // Private channels authorize with the user's JWT, not the anon key.
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (session) await supabase.realtime.setAuth(session.access_token);
      if (cancelled) return;

      channel = supabase.channel(boardTopic(boardId), {
        config: { private: true, broadcast: { self: false }, presence: { key: presenceKey } },
      });
      channelRef.current = channel;

      channel
        .on("broadcast", { event: "elements" }, ({ payload }) => {
          const elements = (payload as { elements?: unknown[] } | undefined)?.elements;
          if (Array.isArray(elements)) applyRemote(elements);
        })
        .on("broadcast", { event: "comment_insert" }, ({ payload }) => emitComment("insert", payload))
        .on("broadcast", { event: "comment_update" }, ({ payload }) => emitComment("update", payload))
        .on("broadcast", { event: "comment_delete" }, ({ payload }) => emitComment("delete", payload))
        .on("presence", { event: "sync" }, updateCollaborators)
        .subscribe((s) => {
          if (s === "SUBSCRIBED") {
            subscribedRef.current = true;
            setStatus(pending.size > 0 ? "saving" : "live");
            trackPresence();
            if (everSubscribed) void reloadFromDatabase();
            everSubscribed = true;
            if (pending.size > 0) void save();
          } else if (s === "CHANNEL_ERROR" || s === "TIMED_OUT" || s === "CLOSED") {
            subscribedRef.current = false;
            if (!cancelled) setStatus("offline");
          }
        });
    })();

    function emitComment(kind: CommentEvent["kind"], payload: unknown) {
      const p = (payload ?? {}) as Record<string, unknown>;
      handlersRef.current.onCommentEvent({
        kind,
        record: (p.record ?? p.new ?? null) as Record<string, unknown> | null,
        old: (p.old_record ?? p.old ?? null) as Record<string, unknown> | null,
      });
    }

    const onOnline = () => void save();
    // Leaving with unsaved strokes: let the browser ask first.
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (pending.size > 0 || savingRef.current) e.preventDefault();
    };
    window.addEventListener("online", onOnline);
    window.addEventListener("beforeunload", onBeforeUnload);

    const t = timers.current;
    return () => {
      cancelled = true;
      subscribedRef.current = false;
      window.removeEventListener("online", onOnline);
      window.removeEventListener("beforeunload", onBeforeUnload);
      window.clearTimeout(t.broadcast);
      window.clearTimeout(t.pointer);
      // Best effort: push whatever is queued before the component goes.
      if (pending.size > 0) void save();
      if (channel) void supabase.removeChannel(channel);
      channelRef.current = null;
    };
  }, [supabase, boardId, presenceKey, pending, applyRemote, trackPresence, reloadFromDatabase, save]);

  return { status, peerCount, peers, handleChange, handlePointer, colorFor };
}
