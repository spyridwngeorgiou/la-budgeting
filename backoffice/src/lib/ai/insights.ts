import "server-only";
import { anthropic, AI_MODEL_FAST } from "./client";

// Shared shape for every "AI phrases numbers we already computed" feature
// (dashboard summary, project health check, ...). The model NEVER computes
// here either -- `facts` is a plain-language list of numbers/labels already
// derived in SQL/JS; the model's only job is turning that list into 2-3
// fluent Greek sentences. Runs on Haiku: this is a phrasing task, not a
// reasoning one, and it's called opportunistically (button click) rather
// than on every page load, so cost stays low either way.
export async function phraseInsight(
  systemPrompt: string,
  facts: string[],
): Promise<{ text: string; usage: { inputTokens: number; outputTokens: number; requestId: string } }> {
  const response = await anthropic.messages.create({
    model: AI_MODEL_FAST,
    max_tokens: 400,
    system: systemPrompt,
    messages: [{ role: "user", content: facts.map((f) => `- ${f}`).join("\n") }],
  });

  const text = response.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();

  return {
    text,
    usage: {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      requestId: response.id,
    },
  };
}
