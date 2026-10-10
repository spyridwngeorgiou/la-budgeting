import { describe, expect, it } from "vitest";
import { extractionRequest, EXTRACTION_MAX_TOKENS, EXTRACTION_SYSTEM_PROMPT } from "./extractRequest";
import { EXTRACTION_EFFORT, EXTRACTION_MODEL, REFUSAL_FALLBACK_BETA } from "./models";

const base = { base64Data: "QUJD", categoryNames: ["Υλικά", "Ενέργεια"] };

describe("extractionRequest", () => {
  it("targets Sonnet 5.5 with an explicit effort and the refusal fallback", () => {
    const req = extractionRequest({ ...base, mediaType: "image/jpeg" });
    expect(req.model).toBe("claude-sonnet-5-5");
    expect(req.model).toBe(EXTRACTION_MODEL);
    expect(req.output_config.effort).toBe(EXTRACTION_EFFORT);
    expect(req.betas).toEqual([REFUSAL_FALLBACK_BETA]);
    expect(req.fallbacks).toBe("default");
    expect(req.max_tokens).toBe(EXTRACTION_MAX_TOKENS);
  });

  it("never sends what Sonnet 5.5 rejects: forced tool_choice, disabled thinking, sampling, prefill", () => {
    const req = extractionRequest({ ...base, mediaType: "application/pdf" }) as Record<string, unknown>;
    expect(req).not.toHaveProperty("tool_choice");
    expect(req).not.toHaveProperty("tools");
    expect(req).not.toHaveProperty("thinking");
    expect(req).not.toHaveProperty("temperature");
    const messages = req.messages as { role: string }[];
    expect(messages.at(-1)?.role).toBe("user");
  });

  it("asks for JSON through structured outputs", () => {
    const req = extractionRequest({ ...base, mediaType: "image/png" });
    expect(req.output_config.format.type).toBe("json_schema");
    expect(JSON.stringify(req.output_config.format.schema)).toContain("issuer_afm");
  });

  it("sends a PDF as a document block and an image as an image block", () => {
    const pdf = extractionRequest({ ...base, mediaType: "application/pdf" }).messages[0].content[0];
    expect(pdf).toMatchObject({ type: "document", source: { type: "base64", media_type: "application/pdf", data: "QUJD" } });
    const img = extractionRequest({ ...base, mediaType: "image/webp" }).messages[0].content[0];
    expect(img).toMatchObject({ type: "image", source: { type: "base64", media_type: "image/webp" } });
  });

  it("puts the org's categories after the fixed prompt", () => {
    const req = extractionRequest({ ...base, mediaType: "image/jpeg" });
    expect(req.system.startsWith(EXTRACTION_SYSTEM_PROMPT)).toBe(true);
    expect(req.system).toContain("Υλικά, Ενέργεια");
  });

  it("lets the eval reproduce the old request: another model, no effort", () => {
    const req = extractionRequest({ ...base, mediaType: "image/jpeg", model: "claude-opus-5", effort: null });
    expect(req.model).toBe("claude-opus-5");
    expect(req.output_config).not.toHaveProperty("effort");
  });
});
