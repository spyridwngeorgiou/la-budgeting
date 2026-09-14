import "server-only";
import Anthropic from "@anthropic-ai/sdk";

// Importing "server-only" makes any accidental client-side import of this
// module a build error, not a leaked API key at runtime.
export const anthropic = new Anthropic({ maxRetries: 3, timeout: 120_000 });

// Model choice: the claude-api skill's standing instruction is to always use
// claude-opus-5 unless the user names a different model. The user asked for
// a hard ~$10 test budget but did not name a cheaper model, so every call
// here defaults to Opus 5 -- keep an eye on ai_usage and Anthropic Console's
// own monthly limit (set there, not enforceable from application code) if
// that's tighter than you'd like once testing starts.
export const AI_MODEL = "claude-opus-5";
export const AI_MODEL_FAST = "claude-haiku-4-5"; // only where explicitly cheaper is fine: NL entity tiebreaks

export function aiEnabled(): boolean {
  return process.env.AI_ENABLED === "true" && !!process.env.ANTHROPIC_API_KEY;
}

interface UsageLogInput {
  orgId: string;
  userId: string | null;
  feature: string;
  model: string;
  inputTokens: number;
  cacheReadTokens: number;
  outputTokens: number;
  requestId: string | null;
}

// Anthropic's own list prices, cents per token -- used only to populate
// ai_usage.cost_cents for the in-app spend dashboard. Not authoritative
// billing (that's Anthropic Console); good enough to catch a runaway loop.
const PRICE_CENTS_PER_MTOK: Record<string, { input: number; output: number }> = {
  "claude-opus-5": { input: 500, output: 2500 },
  "claude-haiku-4-5": { input: 100, output: 500 },
};

export function estimateCostCents(model: string, inputTokens: number, outputTokens: number): number {
  const price = PRICE_CENTS_PER_MTOK[model] ?? PRICE_CENTS_PER_MTOK["claude-opus-5"];
  return (inputTokens * price.input + outputTokens * price.output) / 1_000_000;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function logAiUsage(supabase: any, input: UsageLogInput) {
  await supabase.from("ai_usage").insert({
    org_id: input.orgId,
    feature: input.feature,
    model: input.model,
    input_tokens: input.inputTokens,
    cache_read_tokens: input.cacheReadTokens,
    output_tokens: input.outputTokens,
    cost_cents: estimateCostCents(input.model, input.inputTokens, input.outputTokens),
    user_id: input.userId,
    request_id: input.requestId,
  });
}
