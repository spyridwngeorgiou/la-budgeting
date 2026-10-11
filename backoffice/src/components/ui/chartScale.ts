// Pure maths behind the report charts (BarChart, BandChart), kept out of
// the client components so vitest can test it and nothing pulls recharts.

export type ChartDatum = Record<string, string | number | null>;

export const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : Number(v) || 0);

// [min, max] of what one value axis draws: bars sharing a stack summed per
// sign (as recharts' stackOffset="sign" draws them), lines and lone bars as
// they are. Always includes zero.
export function axisExtent(
  data: ChartDatum[],
  series: { key: string; kind?: "bar" | "line"; stack?: string }[],
  defaultStack?: string,
): [number, number] {
  let lo = 0;
  let hi = 0;
  for (const d of data) {
    const pos = new Map<string, number>();
    const neg = new Map<string, number>();
    for (const s of series) {
      const v = num(d[s.key]);
      const stack = s.kind === "line" ? undefined : (s.stack ?? defaultStack);
      if (!stack) {
        lo = Math.min(lo, v);
        hi = Math.max(hi, v);
        continue;
      }
      const m = v >= 0 ? pos : neg;
      m.set(stack, (m.get(stack) ?? 0) + v);
    }
    for (const v of pos.values()) hi = Math.max(hi, v);
    for (const v of neg.values()) lo = Math.min(lo, v);
  }
  return [lo, hi];
}

// Domains for two value axes whose zeros sit at the same height: both get
// the same share of their range below zero (the larger of the two), plus 5%
// headroom.
export function alignedDomains(left: [number, number], right: [number, number]): [[number, number], [number, number]] {
  const share = ([lo, hi]: [number, number]) => (hi - lo === 0 ? 0 : -lo / (hi - lo));
  const f = Math.max(share(left), share(right));
  const fit = ([lo, hi]: [number, number]): [number, number] => {
    const total = Math.max(f < 1 ? hi / (1 - f) : 0, f > 0 ? -lo / f : 0) * 1.05 || 1;
    return [-f * total, (1 - f) * total];
  };
  return [fit(left), fit(right)];
}

// The lowest point of one series: its index, x label and value (null when
// the series has no numbers).
export function minPoint(data: ChartDatum[], key: string, xKey: string): { index: number; x: string; value: number } | null {
  let best: { index: number; x: string; value: number } | null = null;
  data.forEach((d, index) => {
    const v = d[key];
    if (v == null || v === "" || !Number.isFinite(Number(v))) return;
    const value = Number(v);
    if (!best || value < best.value) best = { index, x: String(d[xKey] ?? ""), value };
  });
  return best;
}

// [min, max] over several series plus fixed values (a threshold, a band),
// padded: `below` share of the span under the minimum (room for a label
// under the lowest point), `above` over the maximum.
export function paddedDomain(
  data: ChartDatum[],
  keys: string[],
  extra: number[] = [],
  below = 0.05,
  above = 0.05,
): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  const see = (v: number) => {
    lo = Math.min(lo, v);
    hi = Math.max(hi, v);
  };
  for (const d of data) {
    for (const k of keys) {
      const v = d[k];
      if (v != null && v !== "" && Number.isFinite(Number(v))) see(Number(v));
    }
  }
  extra.filter(Number.isFinite).forEach(see);
  if (!Number.isFinite(lo)) return [0, 1];
  const span = hi - lo || Math.abs(hi) || 1;
  return [lo - span * below, hi + span * above];
}
