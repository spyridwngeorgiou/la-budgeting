// Pure helpers for the team chat (project_messages, 0060).

export interface ChatMessageLike {
  id: string;
  author_id: string | null;
  created_at: string;
}

// Messages from others newer than the last time this browser had the chat
// open. Your own messages never count.
export function countUnread(messages: readonly ChatMessageLike[], lastReadIso: string | null, meId: string): number {
  const since = lastReadIso ? Date.parse(lastReadIso) : 0;
  return messages.filter((m) => m.author_id !== meId && Date.parse(m.created_at) > since).length;
}

// Inserts or replaces a message, keeping the list oldest-first and capped.
export function upsertMessage<T extends ChatMessageLike>(list: readonly T[], row: T, cap = 300): T[] {
  const next = list.filter((m) => m.id !== row.id);
  next.push(row);
  next.sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
  return next.length > cap ? next.slice(next.length - cap) : next;
}

// Realtime topic for a project's chat; must match realtime_project_topic_ok().
export function projectTopic(projectId: string): string {
  return `project:${projectId}`;
}

export function lastReadStorageKey(projectId: string): string {
  return `collab:chat:lastRead:${projectId}`;
}
