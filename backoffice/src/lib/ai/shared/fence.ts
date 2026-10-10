// Untrusted-content fences, shared by both assistants (back-office finance
// chat and the collab board assistant). Neutral on purpose: this module may
// import nothing from either side, so sharing it never couples them
// (lib/ai/collab/isolation.test.ts checks both directions).
//
// Wraps text written by people other than the current user (board notes,
// file text, transaction descriptions, contact notes, ...) in a named fence
// the system prompt refers to. Any fence-like tag inside the content is
// defanged so the text can't "close" the fence early and pose as
// instructions after it.

export const UNTRUSTED_TAGS = ["board_data", "file_data", "comment_data", "chat_history", "record_data"] as const;
export type UntrustedTag = (typeof UNTRUSTED_TAGS)[number];

const TAG_PATTERN = new RegExp(`<\\s*(\\/?)\\s*(${UNTRUSTED_TAGS.join("|")})`, "gi");

export function fenceUntrusted(tag: UntrustedTag, content: string, attrs: Record<string, string> = {}): string {
  const defanged = content.replace(TAG_PATTERN, "‹$1$2");
  const attrText = Object.entries(attrs)
    .map(([k, v]) => ` ${k}="${v.replace(/["<>]/g, "")}"`)
    .join("");
  return `<${tag}${attrText}>\n${defanged}\n</${tag}>`;
}
