import { formatCompactMoney, formatMoney, formatPercent } from "@/lib/format";

// The composition of the net worth: two horizontal stacked bars on ONE
// scale, «Έχουμε» over «Οφείλουμε», each segment named in the key right
// under its bar (no shared legend), so the two sides compare at a glance.
// Plain HTML, server-rendered: nothing to hydrate, nothing to scroll at
// 390px, prints as is. Tones: navy, the accent and two faint steps.

export interface CompositionSegment {
  key: string;
  label: string;
  amount: number; // ≥ 0
}

const TONES = ["bg-navy", "bg-accent", "bg-chip-border", "bg-hairline", "bg-muted"] as const;

export function CompositionBars({
  rows,
  label,
}: {
  rows: { key: string; title: string; segments: CompositionSegment[] }[];
  label: string;
}) {
  const totals = rows.map((r) => r.segments.reduce((s, x) => s + x.amount, 0));
  const max = Math.max(...totals, 0);
  return (
    <figure aria-label={label} className="print-avoid-break flex min-w-0 flex-col gap-6">
      {rows.map((r, ri) => {
        const total = totals[ri];
        const segs = r.segments.filter((s) => s.amount > 0);
        const width = max > 0 ? (total / max) * 100 : 0;
        return (
          <div key={r.key} className="flex min-w-0 flex-col gap-2">
            <div className="flex items-baseline justify-between gap-3">
              <span className="eyebrow text-muted">{r.title}</span>
              <span className="num text-body font-medium text-ink">{formatMoney(total)}</span>
            </div>
            <div
              role="img"
              aria-label={`${r.title}: ${segs.map((s) => `${s.label} ${formatMoney(s.amount)}`).join(", ") || formatMoney(0)}`}
              className="flex h-8 w-full min-w-0 bg-frame"
            >
              <div className="flex h-full min-w-0" style={{ width: `${width}%` }}>
                {segs.map((s, i) => (
                  <div
                    key={s.key}
                    title={`${s.label}: ${formatMoney(s.amount)}`}
                    className={`${TONES[i % TONES.length]} h-full border-r border-canvas last:border-r-0`}
                    style={{ width: `${total > 0 ? (s.amount / total) * 100 : 0}%` }}
                  />
                ))}
              </div>
            </div>
            {segs.length > 0 && (
              <ul className="flex flex-wrap gap-x-5 gap-y-1 text-small text-text">
                {segs.map((s, i) => (
                  <li key={s.key} className="inline-flex min-w-0 items-center gap-1.5">
                    <span aria-hidden="true" className={`${TONES[i % TONES.length]} inline-block h-2.5 w-2.5 shrink-0`} />
                    <span className="min-w-0">{s.label}</span>
                    <span className="num text-ink">{formatCompactMoney(s.amount)}</span>
                    <span className="num text-muted">{formatPercent(total > 0 ? s.amount / total : 0, { digits: 0 })}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </figure>
  );
}
