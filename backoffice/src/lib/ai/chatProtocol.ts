// The /api/ai/chat wire protocol and saved-history helpers. Pure, shared
// by the route (server) and ChatPanel (client).
//
// The route streams newline-delimited JSON events:
//   {type:"conversation", conversationId, title}  the (possibly new) chat
//   {type:"text", text}                  answer text, as it is generated
//   {type:"tool", name, status}          a tool started / finished / failed
//   {type:"proposal", proposal}          an approval card (ChangeCard)
//   {type:"sources", sources}            «Πηγές» links built by the server
//   {type:"done", messageId}             finished; the answer is saved
//   {type:"error", error}                failed (the stream then ends)
import type { ChangeCard } from "./changeCards";
import { isSafeSourceHref, type Source } from "./links";

export type ChatEvent =
  | { type: "conversation"; conversationId: string; title: string | null }
  | { type: "text"; text: string }
  | { type: "tool"; name: string; status: "start" | "done" | "error" }
  | { type: "proposal"; proposal: ChangeCard }
  | { type: "sources"; sources: Source[] }
  | { type: "done"; messageId: string | null }
  | { type: "error"; error: string };

export interface StoredMessageMeta {
  sources?: Source[];
  change_ids?: string[];
  tools?: string[];
}

// Greek labels for the tool status chips.
export const TOOL_LABEL: Record<string, string> = {
  find_entities: "Αναζήτηση",
  list_transactions: "Κινήσεις",
  aggregate_transactions: "Σύνολα",
  vat_position: "ΦΠΑ",
  project_pnl: "Οικονομικά έργου",
  outstanding: "Οφειλές",
  cashflow_forecast: "Πρόβλεψη ταμείου",
  find_record: "Αναζήτηση εγγραφής",
  propose_change: "Πρόταση αλλαγής",
  create_revenue_plan: "Εκτίμηση εσόδων",
};

// A line-buffered NDJSON parser: feed it chunks, get whole events back.
export function createNdjsonParser(onEvent: (event: ChatEvent) => void) {
  let buffer = "";
  const flushLine = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    try {
      onEvent(JSON.parse(trimmed) as ChatEvent);
    } catch {
      // a malformed line is skipped, never fatal
    }
  };
  return {
    push(chunk: string) {
      buffer += chunk;
      let nl: number;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        flushLine(buffer.slice(0, nl));
        buffer = buffer.slice(nl + 1);
      }
    },
    end() {
      flushLine(buffer);
      buffer = "";
    },
  };
}

// Saved turns -> model messages: the stored text of earlier user/assistant
// turns, oldest first, starting with a user turn and strictly alternating
// (consecutive same-role rows, e.g. after a failed answer, are merged).
export function toModelHistory(
  rows: { role: string; content: string }[],
): { role: "user" | "assistant"; content: string }[] {
  const out: { role: "user" | "assistant"; content: string }[] = [];
  for (const r of rows) {
    const role = r.role === "assistant" ? "assistant" : "user";
    const content = r.content.trim();
    if (!content) continue;
    if (out.length === 0 && role === "assistant") continue;
    const last = out[out.length - 1];
    if (last && last.role === role) last.content += `\n\n${content}`;
    else out.push({ role, content });
  }
  return out;
}

// meta from ai_messages -> the parts the UI trusts (links must stay
// same-app; ids must look like ids).
export function readMeta(meta: unknown): { sources: Source[]; changeIds: string[] } {
  const m = (meta && typeof meta === "object" ? meta : {}) as StoredMessageMeta;
  const sources = (Array.isArray(m.sources) ? m.sources : [])
    .filter((s): s is Source => !!s && typeof s.label === "string" && isSafeSourceHref(s.href))
    .slice(0, 12);
  const changeIds = (Array.isArray(m.change_ids) ? m.change_ids : [])
    .filter((id): id is string => typeof id === "string" && /^[0-9a-f-]{36}$/i.test(id))
    .slice(0, 20);
  return { sources, changeIds };
}

export function conversationTitle(message: string): string {
  return message.replace(/\s+/g, " ").trim().slice(0, 120);
}
