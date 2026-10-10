import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { UserError } from "@/lib/actions";
import { estimateCostCents as estimateUsageCents, type TokenUsage } from "./usage";

export { usageOf } from "./usage";

// Importing "server-only" makes any accidental client-side import of this
// module a build error, not a leaked API key at runtime.
export const anthropic = new Anthropic({ maxRetries: 3, timeout: 120_000 });

// Model choice (claude-api skill):
// - The back-office assistant chat runs on the current flagship,
//   claude-opus-5-5, with an explicit effort (its default is medium) and
//   claude-sonnet-5-5 as the fallback if the id is ever retired/renamed.
//   Refusals are handled server-side with `fallbacks: "default"`.
// - AI_MODEL stays on claude-opus-5 for document/revenue-plan extraction and
//   the board assistant until those paths are migrated and re-checked
//   (Opus 5.5 rejects forced tool_choice and disabled thinking).
// - Insights and NL tiebreaks are phrasing tasks: the small Haiku model.
export const CHAT_MODEL = "claude-opus-5-5";
export const CHAT_MODEL_FALLBACK = "claude-sonnet-5-5";
export const CHAT_EFFORT = "medium" as const;
export const AI_MODEL = "claude-opus-5";
export const AI_MODEL_FAST = "claude-haiku-4-5";
// If AI_MODEL itself is ever retired/renamed, every call site would 404
// with no fallback -- this is the one model callers can retry against on a
// "model not found"-shaped error.
export const AI_MODEL_FALLBACK = "claude-sonnet-5";

export function aiEnabled(): boolean {
  return process.env.AI_ENABLED === "true" && !!process.env.ANTHROPIC_API_KEY;
}

// True only for the specific "this model id doesn't exist" failure mode,
// never for a transient/rate-limit error -- retrying THOSE against a
// different model would silently change behavior for a problem a fallback
// can't fix anyway.
export function isModelNotFoundError(error: unknown): boolean {
  if (!(error instanceof Anthropic.APIError)) return false;
  return error.status === 404 || (error.status === 400 && /model/i.test(error.message ?? ""));
}

interface UsageLogInput {
  orgId: string;
  userId: string | null;
  feature: string;
  model: string;
  inputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens?: number;
  outputTokens: number;
  requestId: string | null;
  conversationId?: string | null;
  // Wall-clock time for the AI call (request to parsed response).
  latencyMs?: number;
}

// Kept for callers that only know input/output (board assistant).
export function estimateCostCents(model: string, inputTokens: number | TokenUsage, outputTokens = 0): number {
  return typeof inputTokens === "number"
    ? estimateUsageCents(model, { inputTokens, outputTokens })
    : estimateUsageCents(model, inputTokens);
}

// Monthly spend ceiling per org, in cents. Checked before every AI call;
// the sum runs in SQL (ai_budget_check, 0084) -- summing rows in JS was cut
// off at PostgREST's 1000-row page and under-counted busy months.
const DEFAULT_MONTHLY_BUDGET_CENTS = 10_000; // €100/mo

export function monthlyBudgetCents(orgSettingsValue?: unknown): number {
  const fromOrg = Number(orgSettingsValue);
  if (Number.isFinite(fromOrg) && fromOrg > 0) return fromOrg;
  const fromEnv = Number(process.env.AI_MONTHLY_BUDGET_CENTS);
  return Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : DEFAULT_MONTHLY_BUDGET_CENTS;
}

export function budgetExceededMessage(capCents: number, spentCents: number): string {
  return (
    `Το μηνιαίο όριο δαπάνης AI (${(capCents / 100).toFixed(2)} €) έχει εξαντληθεί. ` +
    `Δαπανήθηκαν ${(spentCents / 100).toFixed(2)} € αυτόν τον μήνα. Το όριο ρυθμίζεται με τη μεταβλητή περιβάλλοντος AI_MONTHLY_BUDGET_CENTS.`
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function aiBudget(supabase: any, orgId: string): Promise<{ spentCents: number; capCents: number } | null> {
  const { data, error } = await supabase.rpc("ai_budget_check", {
    p_org: orgId,
    p_default_monthly_cents: monthlyBudgetCents(),
  });
  if (error || !data) return null;
  const d = data as { spent_cents?: unknown; cap_cents?: unknown };
  return { spentCents: Number(d.spent_cents ?? 0), capCents: Number(d.cap_cents ?? 0) };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function assertWithinAiBudget(supabase: any, orgId: string): Promise<void> {
  const budget = await aiBudget(supabase, orgId);
  // Fail open on a query error -- a budget check must never be the reason
  // AI is unavailable.
  if (!budget) return;
  if (budget.capCents > 0 && budget.spentCents >= budget.capCents) {
    throw new UserError(budgetExceededMessage(budget.capCents, budget.spentCents));
  }
}

// One row per model call. Never throws: losing a usage row must not fail
// the user's request.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function logAiUsage(supabase: any, input: UsageLogInput) {
  const usage: TokenUsage = {
    inputTokens: input.inputTokens,
    outputTokens: input.outputTokens,
    cacheReadTokens: input.cacheReadTokens,
    cacheWriteTokens: input.cacheWriteTokens ?? 0,
  };
  try {
    await supabase.from("ai_usage").insert({
      org_id: input.orgId,
      feature: input.feature,
      model: input.model,
      input_tokens: input.inputTokens,
      cache_read_tokens: input.cacheReadTokens,
      cache_write_tokens: input.cacheWriteTokens ?? 0,
      output_tokens: input.outputTokens,
      cost_cents: estimateUsageCents(input.model, usage),
      user_id: input.userId,
      request_id: input.requestId,
      conversation_id: input.conversationId ?? null,
      latency_ms: input.latencyMs ?? null,
    });
  } catch (error) {
    console.error("[ai_usage]", error);
  }
}
