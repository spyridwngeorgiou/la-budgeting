import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrgId } from "@/lib/supabase/org";
import { anthropic, AI_MODEL, aiEnabled, logAiUsage } from "@/lib/ai/client";
import { buildAssistantTools } from "@/lib/ai/tools";
import { buildWriteTools } from "@/lib/ai/writeTools";
import { ASSISTANT_SYSTEM_PROMPT } from "@/lib/ai/prompts";
import type Anthropic from "@anthropic-ai/sdk";

// Non-streaming by design: this agentic loop can take several tool-call
// round trips, and the response is a short conversational answer, not a
// long document -- correctness (getting a working v1 shipped, tool results
// fully resolved before any text reaches the client) mattered more here
// than perceived typing speed. Token-level streaming is a natural follow-up
// once this is proven out.
export const maxDuration = 60;

interface ChatRequestBody {
  messages: { role: "user" | "assistant"; content: string }[];
}

export async function POST(request: Request) {
  if (!aiEnabled()) {
    return NextResponse.json(
      { error: "Ο βοηθός AI δεν είναι ακόμα ενεργοποιημένος. Προσθέστε ANTHROPIC_API_KEY και ορίστε AI_ENABLED=true." },
      { status: 503 },
    );
  }

  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.user) return NextResponse.json({ error: "Μη εξουσιοδοτημένο." }, { status: 401 });

  let orgId: string;
  try {
    orgId = await getCurrentOrgId(supabase);
  } catch {
    return NextResponse.json({ error: "Ο χρήστης δεν ανήκει σε οργανισμό." }, { status: 403 });
  }

  const body = (await request.json()) as ChatRequestBody;
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return NextResponse.json({ error: "Λείπουν μηνύματα." }, { status: 400 });
  }

  const { tools: readTools, collectedIds } = buildAssistantTools(supabase);
  const { tools: writeTools, collectedChangeIds } = buildWriteTools(supabase, orgId, session.user.id);
  const tools = [...readTools, ...writeTools];
  const messages: Anthropic.Beta.BetaMessageParam[] = body.messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  try {
    const runner = anthropic.beta.messages.toolRunner({
      model: AI_MODEL,
      max_tokens: 4096,
      system: ASSISTANT_SYSTEM_PROMPT,
      tools,
      messages,
      max_iterations: 8,
    });

    let final: Anthropic.Beta.BetaMessage | undefined;
    for await (const message of runner) {
      final = message;
      if (message.stop_reason === "pause_turn") {
        runner.pushMessages({ role: "assistant", content: message.content });
      }
    }

    if (!final) {
      return NextResponse.json({ error: "Δεν λήφθηκε απάντηση." }, { status: 500 });
    }

    const text = final.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n");

    await logAiUsage(supabase, {
      orgId,
      userId: session.user.id,
      feature: "assistant",
      model: AI_MODEL,
      inputTokens: final.usage.input_tokens,
      cacheReadTokens: final.usage.cache_read_input_tokens ?? 0,
      outputTokens: final.usage.output_tokens,
      requestId: final.id,
    });

    return NextResponse.json({
      text: text || "Δεν μπόρεσα να διατυπώσω απάντηση.",
      transaction_ids: [...collectedIds],
      change_ids: [...collectedChangeIds],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Άγνωστο σφάλμα.";
    return NextResponse.json({ error: `Σφάλμα AI: ${message}` }, { status: 502 });
  }
}
