import { describe, expect, it } from "vitest";
import { estimateCostCents, MODEL_PRICES, priceFor, usageOf } from "./usage";

describe("estimateCostCents", () => {
  it("prices Opus 5.5 input and output at list price", () => {
    // 1M in at $4 + 1M out at $20 = $24 = 2400 cents
    expect(estimateCostCents("claude-opus-5-5", { inputTokens: 1_000_000, outputTokens: 1_000_000 })).toBe(2400);
  });

  it("prices cache reads at 0.05x-0.1x input and cache writes at 1.25x input", () => {
    const reads = estimateCostCents("claude-opus-5-5", { inputTokens: 0, outputTokens: 0, cacheReadTokens: 1_000_000 });
    const writes = estimateCostCents("claude-opus-5-5", { inputTokens: 0, outputTokens: 0, cacheWriteTokens: 1_000_000 });
    expect(reads).toBe(20);
    expect(writes).toBe(500);
    for (const p of Object.values(MODEL_PRICES)) {
      expect(p.cacheWrite).toBe(p.input * 1.25);
      expect(p.cacheRead).toBeLessThanOrEqual(p.input * 0.1);
    }
  });

  it("charges a cached turn far less than the same turn uncached", () => {
    const uncached = estimateCostCents("claude-opus-5-5", { inputTokens: 20_000, outputTokens: 500 });
    const cached = estimateCostCents("claude-opus-5-5", { inputTokens: 1_000, cacheReadTokens: 19_000, outputTokens: 500 });
    expect(cached).toBeLessThan(uncached / 3);
  });

  it("prices Haiku 4.5 for insights", () => {
    expect(estimateCostCents("claude-haiku-4-5", { inputTokens: 1_000_000, outputTokens: 0 })).toBe(100);
  });

  it("prices Sonnet 5.5 (extraction, board assistant) at $2/$10, cache read $0.20, write 1.25x", () => {
    expect(priceFor("claude-sonnet-5-5")).toEqual({ input: 200, output: 1000, cacheRead: 20, cacheWrite: 250 });
    expect(estimateCostCents("claude-sonnet-5-5", { inputTokens: 1_000_000, outputTokens: 1_000_000 })).toBe(1200);
  });

  it("keeps pricing historical claude-opus-5 rows", () => {
    expect(estimateCostCents("claude-opus-5", { inputTokens: 1_000_000, outputTokens: 1_000_000 })).toBe(3000);
  });

  it("prices a suffixed id by the longest known id it extends", () => {
    expect(priceFor("claude-sonnet-5-5-20261001")).toBe(MODEL_PRICES["claude-sonnet-5-5"]);
    expect(priceFor("claude-opus-5-20260101")).toBe(MODEL_PRICES["claude-opus-5"]);
  });

  it("prices an unknown model like the most expensive known one", () => {
    const max = Math.max(...Object.values(MODEL_PRICES).map((p) => p.output));
    expect(priceFor("claude-future-9").output).toBe(max);
  });
});

describe("usageOf", () => {
  it("maps the SDK usage object, treating null cache counts as zero", () => {
    expect(
      usageOf({ input_tokens: 10, output_tokens: 5, cache_read_input_tokens: null, cache_creation_input_tokens: 7 }),
    ).toEqual({ inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 7 });
  });
});
