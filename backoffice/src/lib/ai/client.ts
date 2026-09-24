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
// If AI_MODEL itself is ever retired/renamed, every call site would 404
// with no fallback -- this is the one model callers can retry against on a
// "model not found"-shaped error from the highest-traffic path (chat).
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
  outputTokens: number;
  requestId: string | null;
  // Wall-clock time for the whole AI call (request to parsed response) --
  // the capture loop has never run in production, so this is the number
  // that answers "does this take 8 seconds or 80" once it does.
  latencyMs?: number;
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

// Monthly spend ceiling per org, in cents. Previously the only cap was
// whatever limit was set in the Anthropic Console (account-wide, not
// per-org, and not enforceable from application code) -- a runaway loop
// (e.g. the assistant's tool-calling agent hitting its max_iterations
// repeatedly) could run up real spend before anyone noticed the ai_usage
// dashboard number. This is a real, in-app guard: checked before every AI
// call, using the same cost estimate already computed for ai_usage.
const DEFAULT_MONTHLY_BUDGET_CENTS = 10_000; // €100/mo

export function monthlyBudgetCents(orgSettingsValue?: unknown): number {
  const fromOrg = Number(orgSettingsValue);
  if (Number.isFinite(fromOrg) && fromOrg > 0) return fromOrg;
  const fromEnv = Number(process.env.AI_MONTHLY_BUDGET_CENTS);
  return Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : DEFAULT_MONTHLY_BUDGET_CENTS;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function assertWithinAiBudget(supabase: any, orgId: string): Promise<void> {
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);

  const [{ data, error }, { data: org }] = await Promise.all([
    supabase.from("ai_usage").select("cost_cents").eq("org_id", orgId).gte("created_at", monthStart.toISOString()),
    supabase.from("orgs").select("settings").eq("id", orgId).maybeSingle(),
  ]);
  if (error) return; // fail open on a query error -- a budget check must never be the reason AI is unavailable

  const spentCents = (data ?? []).reduce((sum: number, row: { cost_cents: number | null }) => sum + Number(row.cost_cents ?? 0), 0);
  const capCents = monthlyBudgetCents((org?.settings as Record<string, unknown> | null)?.ai_monthly_budget_cents);
  if (spentCents >= capCents) {
    throw new Error(
      `Το μηνιαίο όριο δαπάνης AI (${(capCents / 100).toFixed(2)} €) έχει εξαντληθεί. ` +
        `Δαπανήθηκαν ${(spentCents / 100).toFixed(2)} € αυτόν τον μήνα. Το όριο ρυθμίζεται με τη μεταβλητή περιβάλλοντος AI_MONTHLY_BUDGET_CENTS.`,
    );
  }
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
    latency_ms: input.latencyMs ?? null,
  });
}
