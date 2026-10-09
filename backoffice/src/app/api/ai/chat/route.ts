import { NextResponse } from "next/server";
import { z } from "zod";
import Anthropic from "@anthropic-ai/sdk";
import type { BetaRunnableTool } from "@anthropic-ai/sdk/lib/tools/BetaRunnableTool";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrgId } from "@/lib/supabase/org";
import {
  aiBudget,
  aiEnabled,
  anthropic,
  budgetExceededMessage,
  CHAT_EFFORT,
  CHAT_MODEL,
  CHAT_MODEL_FALLBACK,
  isModelNotFoundError,
  logAiUsage,
} from "@/lib/ai/client";
import { usageOf } from "@/lib/ai/usage";
import { buildAssistantTools } from "@/lib/ai/tools";
import { buildWriteTools } from "@/lib/ai/writeTools";
import { buildRevenuePlanTools } from "@/lib/ai/revenuePlanTools";
import { ASSISTANT_SYSTEM_PROMPT, assistantContextBlock } from "@/lib/ai/prompts";
import { newChatToolContext, UNTRUSTED_TOOL_NAMES } from "@/lib/ai/chatContext";
import { buildSources } from "@/lib/ai/links";
import { toChangeCard } from "@/lib/ai/changeCards";
import { conversationTitle, toModelHistory, type ChatEvent, type StoredMessageMeta } from "@/lib/ai/chatProtocol";
import { todayAthens } from "@/lib/dates";

// The back-office assistant. Streams NDJSON events (lib/ai/chatProtocol.ts)
// while it runs a manual tool loop: text as it is generated, a status chip
// per tool call, an approval card per proposal, then the «Πηγές» links.
//
// - Everything runs through the caller's RLS-scoped Supabase client.
// - Every model call of the loop is logged to ai_usage (with cache
//   reads/writes), not only the last one.
// - The conversation and its visible turns are saved (0081, private to the
//   user); tool calls and tool results are not.
// - Write tools exist only for editors and only ever create agent_changes
//   proposals; apply_agent_change() applies them after a human approves.
export const maxDuration = 120;

const MAX_ITERATIONS = 8;
const MAX_TOKENS = 16000;
const HISTORY_LIMIT = 30;
const JSON_RETRY_LIMIT = 2;
const FALLBACK_BETA = "server-side-fallback-2026-07-01";

const bodySchema = z
  .object({
    conversationId: z.uuid().nullish(),
    message: z.string().trim().min(1).max(4000),
  })
  .strict();

const CHANGE_COLUMNS =
  "id, status, operation, table_name, action, reason, before, after, changed_fields, conflict, untrusted_context, error, result, created_at";

function jsonError(error: string, status: number) {
  return NextResponse.json({ error }, { status });
}

export async function POST(request: Request) {
  if (!aiEnabled()) {
    return jsonError("Ο βοηθός AI δεν είναι ακόμα ενεργοποιημένος. Προσθέστε ANTHROPIC_API_KEY και ορίστε AI_ENABLED=true.", 503);
  }

  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.user) return jsonError("Μη εξουσιοδοτημένο.", 401);
  const userId = session.user.id;

  let orgId: string;
  try {
    orgId = await getCurrentOrgId(supabase);
  } catch {
    return jsonError("Ο χρήστης δεν ανήκει σε οργανισμό.", 403);
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return jsonError("Μη έγκυρο αίτημα.", 400);
  }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) return jsonError("Μη έγκυρο αίτημα.", 400);
  const { conversationId: requestedId, message } = parsed.data;

  const budget = await aiBudget(supabase, orgId);
  if (budget && budget.capCents > 0 && budget.spentCents >= budget.capCents) {
    return jsonError(budgetExceededMessage(budget.capCents, budget.spentCents), 429);
  }

  const { data: canEditRaw } = await supabase.rpc("has_role", { p_org: orgId, p_min: "editor" });
  const canPropose = canEditRaw === true;

  // ---- conversation + history ----------------------------------------------
  let conversationId: string;
  let title: string | null;
  if (requestedId) {
    const { data: conv } = await supabase
      .from("ai_conversations")
      .select("id, title")
      .eq("id", requestedId)
      .eq("org_id", orgId)
      .maybeSingle();
    if (!conv) return jsonError("Η συζήτηση δεν βρέθηκε.", 404);
    conversationId = conv.id;
    title = conv.title;
  } else {
    title = conversationTitle(message);
    const { data: conv, error } = await supabase
      .from("ai_conversations")
      .insert({ org_id: orgId, user_id: userId, title })
      .select("id")
      .single();
    if (error || !conv) return jsonError("Η συζήτηση δεν αποθηκεύτηκε.", 500);
    conversationId = conv.id;
  }

  const { data: historyDesc } = await supabase
    .from("ai_messages")
    .select("role, content")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(HISTORY_LIMIT);
  const history = toModelHistory((historyDesc ?? []).reverse());
  // The new turn must follow an assistant turn (or open the chat).
  if (history.length > 0 && history[history.length - 1].role === "user") history.pop();

  const { error: userMsgError } = await supabase
    .from("ai_messages")
    .insert({ conversation_id: conversationId, org_id: orgId, role: "user", content: message });
  if (userMsgError) return jsonError("Το μήνυμα δεν αποθηκεύτηκε.", 500);

  const messages: Anthropic.Beta.BetaMessageParam[] = [...history, { role: "user", content: message }];

  // ---- tools -----------------------------------------------------------------
  const ctx = newChatToolContext({ supabase, orgId, userId, conversationId });
  const runnable: BetaRunnableTool[] = [
    ...buildAssistantTools(ctx),
    ...(canPropose ? [...buildWriteTools(ctx), ...buildRevenuePlanTools(ctx)] : []),
  ] as BetaRunnableTool[];
  const byName = new Map(runnable.map((t) => [(t as { name: string }).name, t]));
  // Stream tool inputs as they are generated; inputs are validated by each
  // tool's Zod schema (tool.parse) before anything runs.
  const tools = runnable.map((t) => ({ ...t, eager_input_streaming: true })) as Anthropic.Beta.BetaToolUnion[];

  // Stable prompt + tools first (cached), per-request context after.
  const system: Anthropic.Beta.BetaTextBlockParam[] = [
    { type: "text", text: ASSISTANT_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
    { type: "text", text: assistantContextBlock({ todayIso: todayAthens(), canPropose }) },
  ];

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (event: ChatEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          closed = true;
        }
      };

      let answer = "";
      let model = CHAT_MODEL;
      let failed = false;
      const toolsUsed: string[] = [];

      send({ type: "conversation", conversationId, title });

      const sendNewProposals = async (fromIndex: number) => {
        const ids = ctx.changeIds.slice(fromIndex);
        if (ids.length === 0) return;
        const { data } = await supabase.from("agent_changes").select(CHANGE_COLUMNS).in("id", ids);
        for (const row of data ?? []) send({ type: "proposal", proposal: toChangeCard(row) });
      };

      try {
        let jsonRetries = 0;
        for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
          const startedAt = Date.now();
          let final: Anthropic.Beta.BetaMessage;
          let iterationText = "";
          try {
            const s = anthropic.beta.messages.stream(
              {
                model,
                max_tokens: MAX_TOKENS,
                system,
                tools,
                messages,
                thinking: { type: "adaptive" },
                output_config: { effort: CHAT_EFFORT },
                // Cache the growing conversation too: each loop iteration
                // re-sends it.
                cache_control: { type: "ephemeral" },
                betas: [FALLBACK_BETA],
                fallbacks: "default",
              },
              { signal: request.signal },
            );
            s.on("text", (delta) => {
              iterationText += delta;
              send({ type: "text", text: delta });
            });
            final = await s.finalMessage();
            jsonRetries = 0;
          } catch (error) {
            if (iteration === 0 && model === CHAT_MODEL && !iterationText && isModelNotFoundError(error)) {
              model = CHAT_MODEL_FALLBACK;
              iteration--;
              continue;
            }
            // Only a tool input the SDK couldn't parse (eager streaming) is
            // re-issued; API errors and aborts propagate.
            if (error instanceof Anthropic.APIError || request.signal.aborted || jsonRetries++ >= JSON_RETRY_LIMIT) {
              throw error;
            }
            iteration--;
            continue;
          }
          answer += iterationText;
          await logAiUsage(supabase, {
            orgId,
            userId,
            feature: "assistant",
            // the model that actually served the call (a refusal fallback may differ)
            model: final.model || model,
            ...usageOf(final.usage),
            requestId: final.id,
            conversationId,
            latencyMs: Date.now() - startedAt,
          });

          if (final.stop_reason === "refusal") {
            if (!iterationText) {
              const text = "Δεν μπορώ να βοηθήσω με αυτό το αίτημα.";
              answer += text;
              send({ type: "text", text });
            }
            break;
          }
          if (final.stop_reason === "pause_turn") {
            messages.push({ role: "assistant", content: final.content });
            continue;
          }
          const toolUses = final.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
          if (toolUses.length === 0) break;
          // A tool input cut off at max_tokens can still parse; never run it.
          if (final.stop_reason === "max_tokens") break;

          messages.push({ role: "assistant", content: final.content });
          const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
          for (const use of toolUses) {
            send({ type: "tool", name: use.name, status: "start" });
            toolsUsed.push(use.name);
            const tool = byName.get(use.name);
            const proposalsBefore = ctx.changeIds.length;
            let content: string;
            let isError = false;
            if (!tool) {
              content = JSON.stringify({ error: `Άγνωστο εργαλείο: ${use.name}` });
              isError = true;
            } else {
              try {
                const out = await tool.run(tool.parse(use.input), { toolUse: use, toolUseBlock: use });
                content = typeof out === "string" ? out : JSON.stringify(out);
              } catch (error) {
                content = JSON.stringify({ error: error instanceof Error ? error.message : "Σφάλμα εργαλείου." });
                isError = true;
              }
            }
            // Anything proposed from now on in this turn was made after the
            // model read free text from the data.
            if (UNTRUSTED_TOOL_NAMES.has(use.name)) ctx.untrustedSeen = true;
            send({ type: "tool", name: use.name, status: isError ? "error" : "done" });
            await sendNewProposals(proposalsBefore);
            results.push({ type: "tool_result", tool_use_id: use.id, content, ...(isError ? { is_error: true } : {}) });
          }
          messages.push({ role: "user", content: results });
          if (answer && !answer.endsWith("\n")) {
            answer += "\n\n";
            send({ type: "text", text: "\n\n" });
          }
        }
      } catch (error) {
        failed = true;
        if (!request.signal.aborted) {
          const network = error instanceof Anthropic.APIConnectionError;
          send({
            type: "error",
            error: network ? "Αποτυχία σύνδεσης με τον βοηθό. Δοκιμάστε ξανά." : "Ο βοηθός δεν μπόρεσε να απαντήσει. Δοκιμάστε ξανά.",
          });
        }
      }

      const sources = buildSources(ctx.sources);
      if (sources.length > 0) send({ type: "sources", sources });

      // Save what the user saw, even after an error or abort.
      const content = (answer.trim() || (ctx.changeIds.length > 0 ? "(πρόταση αλλαγής)" : "")).slice(0, 32000);
      let messageId: string | null = null;
      if (content) {
        const meta: StoredMessageMeta = { sources, change_ids: ctx.changeIds, tools: [...new Set(toolsUsed)] };
        const { data } = await supabase
          .from("ai_messages")
          .insert({ conversation_id: conversationId, org_id: orgId, role: "assistant", content, meta: meta as never })
          .select("id")
          .single();
        messageId = data?.id ?? null;
      }
      if (!failed) send({ type: "done", messageId });
      if (!closed) {
        closed = true;
        try {
          controller.close();
        } catch {
          // already closed by a disconnect
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "X-Accel-Buffering": "no",
    },
  });
}
