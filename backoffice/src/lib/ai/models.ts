// Model ids, in one pure module (no SDK, no "server-only") so the ingest
// adapters' pure halves and vitest can import them. client.ts re-exports
// everything here; server code should keep importing from "./client".
//
// Model choice (claude-api skill):
// - The back-office assistant chat runs on the current flagship,
//   claude-opus-5-5, with an explicit effort (its default is medium) and
//   claude-sonnet-5-5 as the fallback if the id is ever retired/renamed.
// - Document extraction (upload, email inbound, unified-ingest adapters) and
//   revenue-plan extraction run on claude-sonnet-5-5 -- transcription into a
//   fixed schema via structured outputs (output_config.format), so Sonnet
//   5.5's 400 on forced tool_choice / disabled thinking doesn't apply.
//   Owner-approved switch from claude-opus-5; checked with the extraction
//   eval (src/lib/ai/eval/extraction.eval.ts).
// - The board assistant (collab) runs on claude-sonnet-5-5 as well.
// - Insights and NL text entry are phrasing tasks: the small Haiku model.
// Refusals on the Opus 5.5 / Sonnet 5.5 paths are retried server-side with
// `fallbacks: "default"` (REFUSAL_FALLBACK_BETA, Claude API only).
//
// claude-opus-5 is no longer used at runtime; it stays in usage.ts's price
// table so historical ai_usage rows still price correctly.
export const CHAT_MODEL = "claude-opus-5-5";
export const CHAT_MODEL_FALLBACK = "claude-sonnet-5-5";
export const CHAT_EFFORT = "medium" as const;

export const EXTRACTION_MODEL = "claude-sonnet-5-5";
// Retried only on a "model not found"-shaped error (isModelNotFoundError).
export const EXTRACTION_MODEL_FALLBACK = "claude-opus-5-5";
// Sonnet 5.5 defaults to effort high with recalibrated levels; the skill's
// starting point for extraction is low. Transcribing small print off a
// phone photo is the one place we'd rather spend a little more, so medium.
export const EXTRACTION_EFFORT = "medium" as const;

export const COLLAB_MODEL = "claude-sonnet-5-5";
export const COLLAB_MODEL_FALLBACK = "claude-opus-5-5";
// Multistep tool use (board, comments, files, proposals): the skill's
// starting point for Sonnet 5.5 is medium.
export const COLLAB_EFFORT = "medium" as const;

export const AI_MODEL_FAST = "claude-haiku-4-5";

export const REFUSAL_FALLBACK_BETA = "server-side-fallback-2026-07-01";
