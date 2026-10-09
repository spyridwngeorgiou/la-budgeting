import { NextResponse } from "next/server";
import { z } from "zod";
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@/lib/supabase/server";
import {
  anthropic,
  AI_MODEL,
  AI_MODEL_FALLBACK,
  aiEnabled,
  estimateCostCents,
  isModelNotFoundError,
  monthlyBudgetCents,
  usageOf,
} from "@/lib/ai/client";
import { collabToolDefinitions, createCollabToolRunner } from "@/lib/ai/collab/tools";
import { COLLAB_SYSTEM_PROMPT, collabContextBlock, withChatHistory } from "@/lib/ai/collab/prompt";
import type { ProposalView } from "@/lib/ai/collab/proposals";
import { el } from "@/lib/i18n/el";

// The board assistant: the only AI route an external partner can reach
// (lib/collab/paths.ts). Isolation, in order:
//   1. The caller's own RLS-scoped Supabase client is used for everything --
//      board lookup, tools, transcript, spend. No elevated client exists in
//      this file or in lib/ai/collab/*, and a vitest guard keeps it so.
//   2. The client names a board; the project is whatever that board belongs
//      to (as RLS lets the caller see it), re-checked with can_access_project.
//      Anything else is a 404, so an id from another project or org reveals
//      nothing.
//   3. The tool set is lib/ai/collab/tools.ts only: board, comments, project
//      files, proposals. Every query is pinned to this board/project.
//   4. Spend goes through the 0059 definers: the org's monthly budget plus a
//      per-user daily cap, so a partner can't drain the org's AI budget.
//
// Streams newline-delimited JSON events to the panel:
//   {type:"thread", threadId}            the (possibly new) thread
//   {type:"text", text}                  answer text, as it is generated
//   {type:"tool", name}                  the assistant is using a tool
//   {type:"proposal", proposal}          a stored proposal card
//   {type:"done", messageId}             finished; the answer is saved
//   {type:"error", error}                failed (the stream then ends)
export const maxDuration = 120;

const MAX_ITERATIONS = 8;
const MAX_TOKENS = 16000;
const HISTORY_LIMIT = 30;
const JSON_RETRY_LIMIT = 2;
// Per-user daily cap for the board assistant, in cents. 0 disables it (the
// org's monthly budget still applies).
const DEFAULT_DAILY_CENTS_PER_USER = 200;

function dailyCentsPerUser(): number {
  const raw = process.env.COLLAB_AI_DAILY_CENTS_PER_USER;
  if (raw === undefined || raw === "") return DEFAULT_DAILY_CENTS_PER_USER;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_DAILY_CENTS_PER_USER;
}

const bodySchema = z
  .object({
    boardId: z.uuid(),
    threadId: z.uuid().nullish(),
    message: z.string().trim().min(1).max(4000),
  })
  .strict();

function jsonError(error: string, status: number) {
  return NextResponse.json({ error }, { status });
}

function todayAthens(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Athens" }).format(new Date());
}

export async function POST(request: Request) {
  const t = el.collabAi.error;
  if (!aiEnabled()) return jsonError(t.disabled, 503);

  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.user) return jsonError(t.unauthorized, 401);

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return jsonError(t.badRequest, 400);
  }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) return jsonError(t.badRequest, 400);
  const { boardId, threadId: requestedThreadId, message } = parsed.data;

  // ---- scope: board -> project, as the caller's RLS sees it ---------------
  const { data: board } = await supabase
    .from("boards")
    .select("id, title, org_id, project_id")
    .eq("id", boardId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!board) return jsonError(t.notFound, 404);
  const projectId = board.project_id;

  const [{ data: canAccess }, { data: canEditRaw }] = await Promise.all([
    supabase.rpc("can_access_project", { p_project: projectId }),
    supabase.rpc("can_edit_collab", { p_project: projectId }),
  ]);
  if (canAccess !== true) return jsonError(t.notFound, 404);
  const canEdit = canEditRaw === true;

  // ---- spend: fail closed -- partners must never get unmetered AI ---------
  const { data: budget, error: budgetError } = await supabase.rpc("collab_ai_budget_check", {
    p_project: projectId,
    p_user_daily_cents: dailyCentsPerUser(),
    p_default_monthly_cents: monthlyBudgetCents(),
  });
  if (budgetError || !budget) return jsonError(t.generic, 503);
  if (budget === "org_budget") return jsonError(t.orgBudget, 429);
  if (budget === "user_cap") return jsonError(t.userCap, 429);

  // ---- thread + transcript --------------------------------------------------
  let threadId: string;
  if (requestedThreadId) {
    const { data: thread } = await supabase
      .from("collab_ai_threads")
      .select("id")
      .eq("id", requestedThreadId)
      .eq("board_id", boardId)
      .maybeSingle();
    if (!thread) return jsonError(t.notFound, 404);
    threadId = thread.id;
  } else {
    const { data: thread, error } = await supabase
      .from("collab_ai_threads")
      .insert({
        board_id: boardId,
        // Overwritten from the board by trigger; sent only to satisfy types.
        org_id: board.org_id,
        project_id: projectId,
        title: message.replace(/\s+/g, " ").slice(0, 120),
        created_by: session.user.id,
      })
      .select("id")
      .single();
    if (error || !thread) return jsonError(t.saveFailed, 500);
    threadId = thread.id;
  }

  const { data: historyDesc } = await supabase
    .from("collab_ai_messages")
    .select("role, content")
    .eq("thread_id", threadId)
    .order("created_at", { ascending: false })
    .limit(HISTORY_LIMIT);
  const history = (historyDesc ?? []).reverse();

  const { error: userMsgError } = await supabase.from("collab_ai_messages").insert({
    thread_id: threadId,
    // Overwritten from the thread by trigger.
    board_id: boardId,
    org_id: board.org_id,
    project_id: projectId,
    role: "user",
    content: message,
    created_by: session.user.id,
  });
  if (userMsgError) return jsonError(t.saveFailed, 500);

  const messages: Anthropic.MessageParam[] = [{ role: "user", content: withChatHistory(history, message) }];

  const tools = collabToolDefinitions(canEdit);
  const runTool = createCollabToolRunner({
    supabase,
    orgId: board.org_id,
    projectId,
    boardId,
    boardTitle: board.title,
    threadId,
    canEdit,
  });
  // Stable prompt first (cached), per-request context after the breakpoint.
  const system: Anthropic.TextBlockParam[] = [
    { type: "text", text: COLLAB_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
    { type: "text", text: collabContextBlock({ boardTitle: board.title, todayIso: todayAthens(), canEdit }) },
  ];

  const encoder = new TextEncoder();
  const userId = session.user.id;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (event: Record<string, unknown>) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          closed = true;
        }
      };

      let answer = "";
      let model = AI_MODEL;
      let failed = false;

      const logUsage = async (msg: Anthropic.Message, startedAt: number) => {
        // Priced with cache reads/writes; the RPC stores the token counts it has columns for.
        const cost = estimateCostCents(model, usageOf(msg.usage));
        await supabase.rpc("log_collab_ai_usage", {
          p_project: projectId,
          p_model: model,
          p_input_tokens: msg.usage.input_tokens,
          p_cache_read_tokens: msg.usage.cache_read_input_tokens ?? 0,
          p_output_tokens: msg.usage.output_tokens,
          p_cost_cents: Math.min(cost, 1000),
          p_request_id: msg.id,
          p_latency_ms: Date.now() - startedAt,
        });
      };

      send({ type: "thread", threadId });

      try {
        let jsonRetries = 0;
        for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
          const startedAt = Date.now();
          let final: Anthropic.Message;
          let iterationText = "";
          try {
            const s = anthropic.messages.stream(
              { model, max_tokens: MAX_TOKENS, system, tools, messages, thinking: { type: "adaptive" } },
              { signal: request.signal },
            );
            s.on("text", (delta) => {
              iterationText += delta;
              send({ type: "text", text: delta });
            });
            final = await s.finalMessage();
            jsonRetries = 0;
          } catch (error) {
            if (iteration === 0 && model === AI_MODEL && isModelNotFoundError(error)) {
              model = AI_MODEL_FALLBACK;
              iteration--;
              continue;
            }
            // Only a tool input the SDK couldn't parse is retried (eager
            // input streaming); API errors and aborts propagate.
            if (
              error instanceof Anthropic.APIError ||
              request.signal.aborted ||
              jsonRetries++ >= JSON_RETRY_LIMIT
            ) {
              throw error;
            }
            iteration--;
            continue;
          }
          answer += iterationText;
          await logUsage(final, startedAt);

          if (final.stop_reason === "refusal") break;
          const toolUses = final.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
          if (toolUses.length === 0) break;
          // A tool input cut off at max_tokens can still parse; never run it.
          if (final.stop_reason === "max_tokens") break;

          messages.push({ role: "assistant", content: final.content });
          const results: Anthropic.ToolResultBlockParam[] = [];
          for (const use of toolUses) {
            send({ type: "tool", name: use.name });
            const outcome = await runTool(use.name, use.input);
            if (outcome.proposal) send({ type: "proposal", proposal: outcome.proposal satisfies ProposalView });
            results.push({
              type: "tool_result",
              tool_use_id: use.id,
              content: outcome.content,
              ...(outcome.isError ? { is_error: true } : {}),
            });
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
          send({ type: "error", error: network ? t.network : t.generic });
        }
      }

      // The visible text is what the team saw; save it even after an error
      // or abort so the shared transcript matches the screen.
      const content = answer.trim().slice(0, 32000);
      let messageId: string | null = null;
      if (content) {
        const { data } = await supabase
          .from("collab_ai_messages")
          .insert({
            thread_id: threadId,
            board_id: boardId,
            org_id: board.org_id,
            project_id: projectId,
            role: "assistant",
            content,
            created_by: userId,
          })
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
