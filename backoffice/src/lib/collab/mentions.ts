import { foldGreek } from "./text";

// @mentions in comments and team chat, and the "@βοηθός" hand-off from team
// chat to the board assistant. Pure, so the parsing rules are unit-tested.

export interface MentionPerson {
  userId: string;
  name: string;
}

// Words that address the assistant rather than a person. Folded (no accents,
// lower case) so "@Βοηθός", "@βοηθος" and "@ΒΟΗΘΟΣ" all count.
const ASSISTANT_HANDLES = ["βοηθοσ", "βοηθε", "assistant", "ai", "kansha"];

// "@βοηθός τι λείπει από την κάτοψη;" -> "τι λείπει από την κάτοψη;".
// Only a leading handle counts: a message that mentions the assistant in
// passing ("ρώτησα τον @βοηθό") stays a team message. Returns null when the
// text is not addressed to the assistant or has no question after it.
export function assistantQuestion(text: string): string | null {
  const m = /^\s*@([^\s,.:;!?]+)[\s,.:;]*([\s\S]*)$/u.exec(text);
  if (!m) return null;
  if (!ASSISTANT_HANDLES.includes(foldGreek(m[1]))) return null;
  const question = m[2].trim();
  return question.length > 0 ? question : null;
}

// The "@partial" word the caret is in, if any, for the suggestion popup.
// An "@" counts only at the start or after whitespace, so emails don't
// trigger it.
export function activeMention(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const m = /(^|\s)@([^\s@]{0,30})$/u.exec(before);
  if (!m) return null;
  return { start: before.length - m[2].length - 1, query: m[2] };
}

// People whose name (any word of it) starts with the query, accent-blind.
export function matchPeople(people: MentionPerson[], query: string, limit = 6): MentionPerson[] {
  const q = foldGreek(query.trim());
  const seen = new Set<string>();
  const out: MentionPerson[] = [];
  for (const p of people) {
    if (!p.name || seen.has(p.userId)) continue;
    const words = foldGreek(p.name).split(/\s+/);
    if (q === "" || words.some((w) => w.startsWith(q)) || foldGreek(p.name).startsWith(q)) {
      seen.add(p.userId);
      out.push(p);
      if (out.length >= limit) break;
    }
  }
  return out;
}

// Replaces the "@partial" at `start` with "@Full Name " and returns the new
// text and caret position.
export function insertMention(text: string, start: number, caret: number, name: string): { text: string; caret: number } {
  const insert = `@${name} `;
  return { text: text.slice(0, start) + insert + text.slice(caret), caret: start + insert.length };
}

// Splits a body into plain and mention segments for rendering, matching the
// longest known names first ("@Μαρία Παπά" before "@Μαρία").
export function mentionSegments(body: string, names: string[]): { text: string; mention: boolean }[] {
  const sorted = [...new Set(names.filter((n) => n.trim().length > 0))].sort((a, b) => b.length - a.length);
  const segments: { text: string; mention: boolean }[] = [];
  let plain = "";
  let i = 0;
  while (i < body.length) {
    if (body[i] === "@" && (i === 0 || /\s/.test(body[i - 1]))) {
      const rest = body.slice(i + 1);
      const hit = sorted.find((n) => foldGreek(rest.slice(0, n.length)) === foldGreek(n));
      if (hit) {
        if (plain) segments.push({ text: plain, mention: false });
        plain = "";
        segments.push({ text: `@${rest.slice(0, hit.length)}`, mention: true });
        i += hit.length + 1;
        continue;
      }
    }
    plain += body[i];
    i += 1;
  }
  if (plain) segments.push({ text: plain, mention: false });
  return segments;
}
