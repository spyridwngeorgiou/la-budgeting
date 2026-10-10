import { describe, expect, it } from "vitest";
import * as models from "./models";
import { MODEL_PRICES } from "./usage";

describe("model mapping", () => {
  it("routes each path to its approved model", () => {
    expect(models.CHAT_MODEL).toBe("claude-opus-5-5");
    expect(models.EXTRACTION_MODEL).toBe("claude-sonnet-5-5");
    expect(models.EXTRACTION_MODEL_FALLBACK).toBe("claude-opus-5-5");
    expect(models.COLLAB_MODEL).toBe("claude-sonnet-5-5");
    expect(models.AI_MODEL_FAST).toBe("claude-haiku-4-5");
  });

  it("no longer uses claude-opus-5 at runtime, and prices every model it does use", () => {
    for (const [name, value] of Object.entries(models)) {
      if (!name.endsWith("MODEL") && !name.endsWith("MODEL_FALLBACK") && !name.endsWith("MODEL_FAST")) continue;
      expect(value, name).not.toBe("claude-opus-5");
      expect(MODEL_PRICES, name).toHaveProperty([value as string]);
    }
  });
});
