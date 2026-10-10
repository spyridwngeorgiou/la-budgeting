// URL parameters of /reports/cash, shared with the dashboard and the AI
// tools so every caller passes cash_forecast() (0066) the same values.

export const FORECAST_SCENARIOS = ["base", "optimistic", "pessimistic"] as const;
export type ForecastScenario = (typeof FORECAST_SCENARIOS)[number];

export const FORECAST_SCOPES = ["corporate", "personal"] as const;
export type ForecastScope = (typeof FORECAST_SCOPES)[number];

export const FORECAST_HORIZONS = [6, 12, 24, 36] as const;
export const MAX_FORECAST_MONTHS = 36;

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

export function parseScenario(v: string | string[] | undefined): ForecastScenario {
  const s = first(v);
  return (FORECAST_SCENARIOS as readonly string[]).includes(s ?? "") ? (s as ForecastScenario) : "base";
}

// null = corporate and personal together
export function parseScope(v: string | string[] | undefined): ForecastScope | null {
  const s = first(v);
  return (FORECAST_SCOPES as readonly string[]).includes(s ?? "") ? (s as ForecastScope) : null;
}

export function parseHorizon(v: string | string[] | undefined, fallback = 12): number {
  const n = Number(first(v));
  if (!Number.isInteger(n) || n < 1) return fallback;
  return Math.min(n, MAX_FORECAST_MONTHS);
}
