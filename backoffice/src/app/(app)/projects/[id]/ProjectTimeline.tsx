// Η πορεία του έργου, όπως στις πύλες των συνεργατών: στην κορυφή τι γίνεται
// τώρα και πόσες μέρες μένουν ως το επόμενο ορόσημο, από κάτω οι φάσεις σε
// μία μπάρα με το «Σήμερα», και για κάθε φάση τι πρέπει να πληρωθεί μέσα της
// (μετρητά / τράπεζα). Late = still open after its planned end.
//
// Payments hang on a phase (transactions.phase_id, 0034): «Μετακίνηση» moves
// the phase, its open payments and the phases that follow it. Payments not
// yet hung on a phase count in the phase whose dates they fall in, and are
// listed at the end to be assigned.

import { movePhase, setPaymentPhase } from "./phase-actions";

type Phase = {
  id: string;
  sort_order: number;
  name: string;
  kind: string;
  planned_start: string;
  planned_end: string;
  status: string;
  done_on: string | null;
  is_estimate: boolean;
  notes: string | null;
};
export type Due = { id: string; date: string; amount: number; pool: "cash" | "bank"; description: string; phaseId: string | null; recurring: boolean };

const eur = new Intl.NumberFormat("el-GR", { maximumFractionDigits: 0 });
const money = (n: number) => `${eur.format(Math.round(n))} €`;
const day = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("el-GR", { day: "2-digit", month: "2-digit", year: "2-digit", timeZone: "UTC" });
const DAY = 86400000;
const t = (d: string) => Date.parse(`${d}T00:00:00Z`);

export function ProjectTimeline({ projectId, phases, dues, today }: { projectId: string; phases: Phase[]; dues: Due[]; today: string }) {
  if (!phases.length) return null;
  const sorted = [...phases].sort((a, b) => a.sort_order - b.sort_order);
  const start = Math.min(...sorted.map((p) => t(p.planned_start)));
  const end = Math.max(...sorted.map((p) => t(p.planned_end))) + DAY;
  const span = end - start;
  const now = t(today);
  const late = (p: Phase) => p.status !== "done" && t(p.planned_end) < now;
  const active = sorted.filter((p) => p.status === "active");
  const next = sorted.find((p) => p.status !== "done" && t(p.planned_end) >= now && p.kind === "milestone");
  const daysToNext = next ? Math.round((t(next.planned_end) - now) / DAY) : null;
  const lateCount = sorted.filter(late).length;

  // Money of each phase: the payments hung on it, plus unassigned open rows
  // of this project that fall inside its dates.
  const phaseIds = new Set(sorted.map((p) => p.id));
  const unassigned = dues.filter((d) => !d.phaseId || !phaseIds.has(d.phaseId));
  const toAssign = unassigned.filter((d) => !d.recurring); // monthly plan rows stay off the list
  const dueIn = (p: Phase) => {
    const from = p.kind === "milestone" ? t(p.planned_end) - 30 * DAY : t(p.planned_start);
    const to = t(p.planned_end);
    const linked = dues.filter((d) => d.phaseId === p.id);
    const loose = unassigned.filter((d) => t(d.date) > from - DAY && t(d.date) <= to);
    const all = [...linked, ...loose];
    return {
      linked,
      cash: all.filter((d) => d.pool === "cash").reduce((s, d) => s + d.amount, 0),
      bank: all.filter((d) => d.pool === "bank").reduce((s, d) => s + d.amount, 0),
    };
  };

  const color = (p: Phase) => (p.status === "done" ? "bg-sage-ink" : late(p) ? "bg-red-ink" : p.status === "active" ? "bg-[#c8641e]" : "bg-line");

  return (
    <section className="rounded-lg border border-line bg-surface">
      {/* Ταυτότητα: τι γίνεται τώρα, πόσο μένει */}
      <div className="grid grid-cols-1 divide-y divide-line sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        <div className="p-4">
          <div className="text-xs uppercase tracking-wide text-ink-muted">Σε εξέλιξη τώρα</div>
          <div className="mt-1 font-medium">{active.map((p) => p.name).join(" · ") || "—"}</div>
        </div>
        <div className="p-4">
          <div className="text-xs uppercase tracking-wide text-ink-muted">{next ? `Μέρες ως: ${next.name}` : "Επόμενο ορόσημο"}</div>
          <div className="mt-1 text-3xl font-semibold tabular-nums">{daysToNext ?? "—"}</div>
          {next && <div className="text-xs text-ink-muted">{day(next.planned_end)}{next.is_estimate ? " · εκτίμηση" : ""}</div>}
        </div>
        <div className="p-4">
          <div className="text-xs uppercase tracking-wide text-ink-muted">Πρόγραμμα</div>
          <div className={`mt-1 font-medium ${lateCount ? "text-red-ink" : "text-sage-ink"}`}>
            {lateCount ? `${lateCount} ${lateCount === 1 ? "φάση" : "φάσεις"} εκτός προγράμματος` : "Εντός προγράμματος"}
          </div>
          <div className="text-xs text-ink-muted">{day(sorted[0].planned_start)} → {day(sorted[sorted.length - 1].planned_end)}</div>
        </div>
      </div>

      {/* Χρονογράφημα */}
      <div className="border-t border-line p-4">
        <div className="text-xs uppercase tracking-wide text-ink-muted">Χρονογράφημα φάσεων</div>
        <div className="relative mt-6 h-7 overflow-hidden rounded bg-bg">
          {sorted.map((p, i) => {
            const left = ((t(p.planned_start) - start) / span) * 100;
            const width = p.kind === "milestone" ? 0.6 : ((t(p.planned_end) + DAY - t(p.planned_start)) / span) * 100;
            return (
              <div key={p.id} title={`${i + 1}. ${p.name}`} className={`absolute top-0 flex h-full items-center justify-center border-r border-surface text-[10px] text-white ${color(p)}`}
                style={{ left: `${left}%`, width: `${Math.max(width, 0.6)}%` }}>
                {width > 3 ? i + 1 : ""}
              </div>
            );
          })}
        </div>
        {now >= start && now <= end && (
          <div className="relative -mt-9 h-11" aria-hidden>
            <div className="absolute top-0 h-full border-l-2 border-dashed border-ink" style={{ left: `${((now - start) / span) * 100}%` }}>
              <span className="absolute -top-4 left-1 whitespace-nowrap text-[10px] font-medium">Σήμερα</span>
            </div>
          </div>
        )}
        <div className="mt-2 flex flex-wrap gap-4 text-xs text-ink-muted">
          <span><span className="mr-1 inline-block h-2 w-2 bg-sage-ink" />Ολοκληρωμένες</span>
          <span><span className="mr-1 inline-block h-2 w-2 bg-[#c8641e]" />Σε εξέλιξη</span>
          <span><span className="mr-1 inline-block h-2 w-2 bg-line" />Επόμενες</span>
          <span><span className="mr-1 inline-block h-2 w-2 bg-red-ink" />Εκτός προγράμματος</span>
        </div>
      </div>

      {/* Φάσεις και τι πληρώνεται σε καθεμία */}
      <ol className="border-t border-line">
        {sorted.map((p, i) => {
          const m = dueIn(p);
          return (
            <li key={p.id} className={`flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-line px-4 py-3 last:border-b-0 ${p.status === "active" ? "bg-[#c8641e]/5" : ""}`}>
              <span className="w-6 text-xs tabular-nums text-ink-faint">{String(i + 1).padStart(2, "0")}</span>
              <span className={`inline-block h-2.5 w-2.5 rounded-full ${p.status === "next" && !late(p) ? "border border-ink-faint" : color(p)}`} />
              <span className="min-w-0 flex-1">
                <span className={p.status === "active" ? "font-medium" : ""}>{p.name}</span>
                {p.notes && <span className="block text-xs text-ink-muted">{p.notes}</span>}
              </span>
              <span className="text-xs tabular-nums text-ink-muted">
                {p.kind === "milestone" ? day(p.planned_end) : `${day(p.planned_start)} – ${day(p.planned_end)}`}
                {p.is_estimate && p.status !== "done" ? " · εκτ." : ""}
              </span>
              <span className="w-44 text-right text-xs tabular-nums">
                {m.cash > 0 && <span className="block">μετρητά {money(m.cash)}</span>}
                {m.bank > 0 && <span className="block">τράπεζα {money(m.bank)}</span>}
              </span>
              {(m.linked.length > 0 || p.status !== "done") && (
                <details className="w-full pl-10 text-xs">
                  <summary className="cursor-pointer text-ink-muted">
                    {m.linked.length ? `${m.linked.length} ${m.linked.length === 1 ? "πληρωμή" : "πληρωμές"} · ${money(m.linked.reduce((s, d) => s + d.amount, 0))}` : "Καμία πληρωμή δεμένη"}
                    {p.status !== "done" ? " · μετακίνηση" : ""}
                  </summary>
                  <ul className="mt-2 space-y-1">
                    {m.linked.map((d) => (
                      <li key={d.id} className="flex gap-3 tabular-nums">
                        <span className="w-16 text-ink-muted">{day(d.date)}</span>
                        <span className="flex-1">{d.description}</span>
                        <span>{d.pool === "cash" ? "μετρητά" : "τράπεζα"} {money(d.amount)}</span>
                      </li>
                    ))}
                  </ul>
                  {p.status !== "done" && (
                    <form action={movePhase.bind(null, projectId, p.id)} className="mt-2 flex flex-wrap items-center gap-2">
                      <span className="text-ink-muted">Νέα έναρξη:</span>
                      <input type="date" name="start" defaultValue={p.planned_start} required className="rounded border border-line-strong px-2 py-1" />
                      <button className="rounded border border-line-strong px-2 py-1 hover:bg-bg">Μετακίνηση</button>
                      <span className="text-ink-muted">Μετακινούνται μαζί οι πληρωμές της και οι φάσεις που ακολουθούν.</span>
                    </form>
                  )}
                </details>
              )}
            </li>
          );
        })}
      </ol>

      {/* Ανοιχτές πληρωμές που δεν έχουν δεθεί σε φάση */}
      {toAssign.length > 0 && (
        <details className="border-t border-line px-4 py-3 text-xs">
          <summary className="cursor-pointer font-medium">Πληρωμές χωρίς φάση ({toAssign.length}) · {money(toAssign.reduce((s, d) => s + d.amount, 0))}</summary>
          <ul className="mt-2 space-y-1">
            {[...toAssign].sort((a, b) => t(a.date) - t(b.date)).map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-3 tabular-nums">
                <span className="w-16 text-ink-muted">{day(d.date)}</span>
                <span className="min-w-0 flex-1">{d.description}</span>
                <span>{d.pool === "cash" ? "μετρητά" : "τράπεζα"} {money(d.amount)}</span>
                <form action={setPaymentPhase.bind(null, projectId, d.id)} className="flex gap-1">
                  <select name="phase_id" defaultValue="" className="rounded border border-line-strong px-1 py-0.5">
                    <option value="">Φάση…</option>
                    {sorted.filter((p) => p.status !== "done").map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                  <button className="rounded border border-line-strong px-2 py-0.5 hover:bg-bg">Σύνδεση</button>
                </form>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
