// Pricing for the in-app spend figures (ai_usage.cost_cents). Pure, so
// vitest covers it. Not authoritative billing (that is Anthropic Console);
// accurate enough for the monthly budget guard and the spend dashboard.

export interface ModelPrice {
  // US cents per million tokens.
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number; // 5-minute cache writes: 1.25x input
}

// List prices, from the claude-api skill's model table (cached 2026-09-25).
// claude-opus-5 and claude-sonnet-5 are no longer called at runtime; they stay
// so historical ai_usage rows (and a refusal served by a fallback) price right.
export const MODEL_PRICES: Record<string, ModelPrice> = {
  "claude-opus-5-5": { input: 400, output: 2000, cacheRead: 20, cacheWrite: 500 },
  "claude-opus-5": { input: 500, output: 2500, cacheRead: 50, cacheWrite: 625 },
  "claude-sonnet-5-5": { input: 200, output: 1000, cacheRead: 20, cacheWrite: 250 },
  "claude-sonnet-5": { input: 200, output: 1000, cacheRead: 20, cacheWrite: 250 },
  "claude-haiku-4-5": { input: 100, output: 500, cacheRead: 10, cacheWrite: 125 },
};

// An unknown (new, renamed) model is priced like the most expensive one we
// know, so the budget guard errs on the side of stopping early.
const FALLBACK_PRICE = MODEL_PRICES["claude-opus-5"];

export function priceFor(model: string): ModelPrice {
  const exact = MODEL_PRICES[model];
  if (exact) return exact;
  // A dated/suffixed id (response.model may carry one): the longest known id
  // it extends -- longest, because claude-sonnet-5-5 also starts with
  // claude-sonnet-5.
  const base = Object.keys(MODEL_PRICES)
    .filter((id) => model.startsWith(`${id}-`))
    .sort((a, b) => b.length - a.length)[0];
  return base ? MODEL_PRICES[base] : FALLBACK_PRICE;
}

export interface TokenUsage {
  // Uncached input only -- the API reports cache reads/writes separately.
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

export function estimateCostCents(model: string, usage: TokenUsage): number {
  const p = priceFor(model);
  return (
    (usage.inputTokens * p.input +
      usage.outputTokens * p.output +
      (usage.cacheReadTokens ?? 0) * p.cacheRead +
      (usage.cacheWriteTokens ?? 0) * p.cacheWrite) /
    1_000_000
  );
}

// The SDK's `usage` object (Message or BetaMessage) -> TokenUsage.
export function usageOf(usage: {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
}): Required<TokenUsage> {
  return {
    inputTokens: usage.input_tokens ?? 0,
    outputTokens: usage.output_tokens ?? 0,
    cacheReadTokens: usage.cache_read_input_tokens ?? 0,
    cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
  };
}
