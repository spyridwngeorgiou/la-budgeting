"use client";

import { useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { computeScenario, monthsFrom, type Choices, type Flow, type Lever } from "@/lib/finance/scenarios";
import { formatMoney } from "@/lib/format";
import { Card } from "@/components/ui";

const MONTHS = 12;
const SERIES = "#2a78d6";

const monthLabel = (m: string) =>
  new Date(`${m}-01T00:00:00Z`).toLocaleDateString("el-GR", { month: "short", year: "2-digit", timeZone: "UTC" });
const short = (n: number) => (Math.abs(n) >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}εκ` : `${Math.round(n / 1000)}χ`);

function Tile({ label, value, note, tone }: { label: string; value: string; note?: string; tone?: "red" | "green" }) {
  return (
    <div className="rounded-md border border-line bg-surface p-3">
      <div className="text-xs text-ink-muted">{label}</div>
      <div className={`font-mono text-lg ${tone === "red" ? "text-red-ink" : tone === "green" ? "text-sage-ink" : ""}`}>{value}</div>
      {note && <div className="text-xs text-ink-faint">{note}</div>}
    </div>
  );
}

export function ScenarioPanel({
  start, opening, buffer, flows, levers, delayable,
}: { start: string; opening: number; buffer: number; flows: Flow[]; levers: Lever[]; delayable: Flow[] }) {
  const months = monthsFrom(start, MONTHS);
  const inflowLevers = levers.filter((l) => l.kind === "inflow");
  const hasLoan = levers.some((l) => l.kind === "loan");

  const [choices, setChoices] = useState<Choices>(() => ({
    on: Object.fromEntries(inflowLevers.map((l) => [l.id, l.kind === "inflow" && l.certain])),
    inflowMonth: Object.fromEntries(inflowLevers.map((l) => [l.id, l.month < start ? start : l.month])),
    delay: {},
    personalMonthly: 7500,
    weightInflows: true,
  }));
  const set = (patch: Partial<Choices>) => setChoices((c) => ({ ...c, ...patch }));

  const result = useMemo(
    () => computeScenario({ start, months: MONTHS, opening, buffer, flows, levers, choices }),
    [start, opening, buffer, flows, levers, choices],
  );
  const chartData = result.rows.map((r) => ({ month: monthLabel(r.month), closing: Math.round(r.closing) }));

  return (
    <div className="flex flex-col gap-4">
      {/* Δείκτες */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Tile label="Διαθέσιμα σήμερα" value={formatMoney(opening)} />
        <Tile
          label="Χαμηλότερο σημείο"
          value={formatMoney(result.lowest.closing)}
          note={monthLabel(result.lowest.month)}
          tone={result.lowest.closing < buffer ? "red" : undefined}
        />
        <Tile label={`Σε ${MONTHS} μήνες`} value={formatMoney(result.endBalance)} note={monthLabel(months[months.length - 1])} />
        <Tile
          label="Κάλυψη με τα σημερινά"
          value={Number.isFinite(result.coverageMonths) ? `${result.coverageMonths.toFixed(1)} μήνες` : "—"}
          note="χωρίς νέες εισπράξεις"
        />
      </div>

      {result.firstNegative ? (
        <Card className="border-red-ink/30 bg-red-bg text-sm text-red-ink">
          ⚠️ Τα χρήματα δεν φτάνουν: από <b>{monthLabel(result.firstNegative)}</b> το ταμείο γίνεται αρνητικό.
        </Card>
      ) : result.firstBelowBuffer ? (
        <Card className="border-amber-300 bg-amber-bg text-sm text-amber-ink">
          ⚠️ Από <b>{monthLabel(result.firstBelowBuffer)}</b> πέφτουμε κάτω από το απόθεμα ασφαλείας ({formatMoney(buffer)}).
        </Card>
      ) : (
        <Card className="bg-sage text-sm text-sage-ink">✓ Τα χρήματα φτάνουν και μένουμε πάνω από το απόθεμα ασφαλείας.</Card>
      )}

      {/* Γράφημα */}
      <Card>
        <h2 className="mb-2 text-sm font-semibold">Ταμείο στο τέλος κάθε μήνα</h2>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
              <CartesianGrid stroke="var(--color-line)" vertical={false} />
              <XAxis dataKey="month" tick={{ fontSize: 12, fill: "var(--color-ink-muted)" }} tickLine={false} axisLine={{ stroke: "var(--color-line)" }} />
              <YAxis tickFormatter={short} tick={{ fontSize: 12, fill: "var(--color-ink-muted)" }} tickLine={false} axisLine={false} width={48} />
              <ReferenceLine y={buffer} stroke="var(--color-amber-ink)" strokeDasharray="4 4" label={{ value: "απόθεμα", position: "insideTopRight", fontSize: 11, fill: "var(--color-amber-ink)" }} />
              <ReferenceLine y={0} stroke="var(--color-ink-faint)" />
              <Tooltip
                formatter={(v) => [formatMoney(Number(v)), "Ταμείο"]}
                contentStyle={{ fontSize: 12, borderRadius: 6, borderColor: "var(--color-line)" }}
                cursor={{ stroke: "var(--color-line-strong)" }}
              />
              <Line type="monotone" dataKey="closing" stroke={SERIES} strokeWidth={2} dot={{ r: 4, fill: SERIES, stroke: "#fff", strokeWidth: 2 }} activeDot={{ r: 6 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Card>

      {/* Επιλογές */}
      <Card>
        <h2 className="mb-3 text-sm font-semibold">Επιλογές</h2>
        <div className="flex flex-col gap-4 text-sm">
          <div>
            <div className="mb-1 text-xs font-medium text-ink-muted">Χρήματα που περιμένουμε</div>
            {inflowLevers.map((l) =>
              l.kind !== "inflow" ? null : (
                <div key={l.id} className="flex flex-wrap items-center gap-2 py-1">
                  <label className="flex min-w-0 flex-1 items-center gap-2">
                    <input type="checkbox" checked={!!choices.on[l.id]} onChange={(e) => set({ on: { ...choices.on, [l.id]: e.target.checked } })} />
                    <span className="truncate">{l.label}</span>
                    <span className="font-mono text-ink-muted">{formatMoney(l.amount)}</span>
                    {!l.certain && <span className="text-xs text-amber-ink">αβέβαιο</span>}
                    {l.debt && <span className="text-xs text-ink-faint">δάνειο</span>}
                  </label>
                  <select
                    className="rounded border border-line bg-surface px-2 py-1"
                    value={choices.inflowMonth[l.id]}
                    onChange={(e) => set({ inflowMonth: { ...choices.inflowMonth, [l.id]: e.target.value } })}
                    disabled={!choices.on[l.id]}
                  >
                    {months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
                  </select>
                </div>
              ),
            )}
          </div>

          {hasLoan && (
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={!!choices.on["bank-loan"]} onChange={(e) => set({ on: { ...choices.on, "bank-loan": e.target.checked } })} />
              <span>Εγκρίνεται το τραπεζικό δάνειο (εκταμιεύσεις όπως στο πλάνο, τόκοι χάριτος)</span>
            </label>
          )}

          {delayable.length > 0 && (
            <div>
              <div className="mb-1 text-xs font-medium text-ink-muted">Μεγάλες πληρωμές — καθυστέρηση</div>
              {delayable.map((f) => (
                <div key={f.id} className="flex flex-wrap items-center gap-2 py-1">
                  <span className="min-w-0 flex-1 truncate">{f.label}</span>
                  <span className="font-mono text-ink-muted">{formatMoney(f.amount)}</span>
                  <span className="text-xs text-ink-faint">{monthLabel(f.month)}</span>
                  <select
                    className="rounded border border-line bg-surface px-2 py-1"
                    value={choices.delay[f.id] ?? 0}
                    onChange={(e) => set({ delay: { ...choices.delay, [f.id]: Number(e.target.value) } })}
                  >
                    {[0, 1, 2, 3, 6].map((n) => <option key={n} value={n}>{n === 0 ? "στην ώρα της" : `+${n} μήνες`}</option>)}
                  </select>
                </div>
              ))}
            </div>
          )}

          <label className="flex flex-wrap items-center gap-2">
            <span className="flex-1">Προσωπικά έξοδα τον μήνα</span>
            <input
              type="number" step={500} min={0}
              className="w-32 rounded border border-line bg-surface px-2 py-1 text-right font-mono"
              value={choices.personalMonthly}
              onChange={(e) => set({ personalMonthly: Number(e.target.value) || 0 })}
            />
          </label>
        </div>
      </Card>

      {/* Ανά μήνα */}
      <details className="rounded-md border border-line bg-surface p-4">
        <summary className="cursor-pointer text-sm font-semibold">Ανά μήνα</summary>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-right text-sm">
            <thead className="text-xs text-ink-muted">
              <tr><th className="p-1 text-left">Μήνας</th><th className="p-1">Εισπράξεις</th><th className="p-1">Χρηματοδότηση</th><th className="p-1">Πληρωμές</th><th className="p-1">Ταμείο τέλους</th></tr>
            </thead>
            <tbody className="font-mono">
              {result.rows.map((r) => (
                <tr key={r.month} className="border-t border-line">
                  <td className="p-1 text-left font-sans">{monthLabel(r.month)}</td>
                  <td className="p-1">{formatMoney(r.inflow)}</td>
                  <td className="p-1">{r.financing ? formatMoney(r.financing) : "—"}</td>
                  <td className="p-1">{formatMoney(r.outflow + r.personal + r.interest)}</td>
                  <td className={`p-1 ${r.closing < buffer ? "text-red-ink" : ""}`}>{formatMoney(r.closing)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
