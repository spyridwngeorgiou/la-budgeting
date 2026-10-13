"use client";

import { useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { addMonths, computeScenario, monthsFrom, type Choices, type Flow, type Lever, type ScenarioResult } from "@/lib/finance/scenarios";

// Σενάρια -- one page, read top to bottom (switches right under the chart):
//   0. ready scenarios   1. three numbers (cash, banks, total)   2. the chart
//   3. the switches       4. the construction verdict   5. month by month
// Rounded euros everywhere (the ledger keeps cents; this is an overview).

const MONTHS = 12;
// One line only -- the scenario the switches build -- in black. The user found
// comparison lines confusing.
const LINES = [
  { key: "mine", label: "Οι επιλογές μου", color: "var(--color-ink)", dash: undefined, width: 3 },
] as const;
type View = "total" | "cash" | "bank";
const VIEW_LABEL: Record<View, string> = { total: "Σύνολο", cash: "Μετρητά", bank: "Τράπεζες" };
type Row = ScenarioResult["rows"][number];

const eur = new Intl.NumberFormat("el-GR", { maximumFractionDigits: 0 });
const money = (n: number) => `${eur.format(Math.round(n))} €`;
const signed = (n: number) => `${n >= 0 ? "+" : "−"}${eur.format(Math.abs(Math.round(n)))}`;
const monthLabel = (m: string) =>
  new Date(`${m}-01T00:00:00Z`).toLocaleDateString("el-GR", { month: "short", year: "2-digit", timeZone: "UTC" });
const monthLong = (m: string) =>
  new Date(`${m}-01T00:00:00Z`).toLocaleDateString("el-GR", { month: "long", year: "numeric", timeZone: "UTC" });
const short = (n: number) => (Math.abs(n) >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}εκ` : `${Math.round(n / 1000)}χ`);
const valueOf = (view: View) => (r: Row) => (view === "cash" ? r.cash.closing : view === "bank" ? r.bank.closing : r.closing);
const lowestOf = (rows: Row[], v: (r: Row) => number) => rows.reduce((a, b) => (v(b) < v(a) ? b : a));
const tone = (n: number, buffer?: number) => (n < 0 ? "text-red-ink" : buffer != null && n < buffer ? "text-amber-ink" : "text-ink");

function Stat({ label, today, low, lowMonth, end, buffer }: { label: string; today: number; low: number; lowMonth: string; end: number; buffer?: number }) {
  return (
    <div className="rounded-lg border border-line bg-surface p-4">
      <div className="text-xs uppercase tracking-wide text-ink-muted">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{money(today)}</div>
      <div className="mt-3 space-y-0.5 text-xs text-ink-muted">
        <div>
          χαμηλότερο <span className={`tabular-nums font-medium ${tone(low, buffer)}`}>{money(low)}</span> · {monthLabel(lowMonth)}
        </div>
        <div>
          σε {MONTHS} μήνες <span className={`tabular-nums font-medium ${tone(end)}`}>{money(end)}</span>
        </div>
      </div>
    </div>
  );
}

function ConstructionBox({ c, result, withMine, buffer }: { c: { label: string; from: string; to: string }; result: ScenarioResult; withMine: boolean; buffer: number }) {
  const rows = result.rows.filter((r) => r.month >= c.from && r.month <= c.to);
  if (!rows.length) return null;
  const cash = lowestOf(rows, (r) => r.cash.closing);
  const bank = lowestOf(rows, (r) => r.bank.closing);
  const negative = rows.find((r) => r.cash.closing < 0 || r.bank.closing < 0);
  const underBuffer = rows.filter((r) => r.closing < buffer).length;
  const ok = !negative && underBuffer === 0;
  const verdict = negative
    ? `Δεν αντέχουμε — από ${monthLong(negative.month)} ${negative.cash.closing < 0 ? "τελειώνουν τα μετρητά" : "τελειώνουν οι τράπεζες"}`
    : underBuffer
      ? `Αντέχουμε, αλλά ${underBuffer} μήνες κάτω από το απόθεμα`
      : "Αντέχουμε όλη την κατασκευή";
  return (
    <div className={`rounded-lg border p-5 ${ok ? "border-sage-strong bg-sage/40" : "border-red-ink/30 bg-red-bg"}`}>
      <div className="text-xs uppercase tracking-wide text-ink-muted">Κατασκευή {c.label}</div>
      <div className={`mt-1 text-xl font-semibold ${ok ? "text-sage-ink" : "text-red-ink"}`}>{ok ? "✓ " : "⚠ "}{verdict}</div>
      <div className="mt-1 text-sm text-ink-muted">
        {monthLabel(c.from)} → άνοιγμα {monthLabel(c.to)} · {withMine ? "με τις επιλογές μου" : "με το δάνειο"}
      </div>
      <div className="mt-4 flex flex-wrap gap-x-8 gap-y-2 text-sm">
        <div>
          <span className="text-ink-muted">Μετρητά, χαμηλότερο </span>
          <span className={`font-medium tabular-nums ${tone(cash.cash.closing)}`}>{money(cash.cash.closing)}</span>
          <span className="text-ink-faint"> · {monthLabel(cash.month)}</span>
        </div>
        <div>
          <span className="text-ink-muted">Τράπεζες, χαμηλότερο </span>
          <span className={`font-medium tabular-nums ${tone(bank.bank.closing)}`}>{money(bank.bank.closing)}</span>
          <span className="text-ink-faint"> · {monthLabel(bank.month)}</span>
        </div>
      </div>
      {!withMine && <div className="mt-3 text-xs text-ink-faint">Χωρίς δάνειο η κατασκευή δεν ξεκινά, γι’ αυτό μετριέται με το δάνειο.</div>}
    </div>
  );
}

// "Βγαίνει το πλάνο;" -- one sentence for the chosen scenario, and the
// transfer from the banks that keeps cash in hand above three months of daily
// cash spending.
function Verdict({ result, cashFloor, onTry }: { result: ScenarioResult; cashFloor: number; onTry: (t: { month: string; amount: number }) => void }) {
  const round = (n: number) => Math.ceil(n / 1000) * 1000;
  let tone: "ok" | "warn" | "bad" = "ok";
  let title: string;
  let detail: string;
  let fix: { month: string; amount: number } | null = null;
  if (result.firstNegative) {
    tone = "bad";
    title = `Δεν βγαίνει — τα χρήματα τελειώνουν ${monthLong(result.firstNegative)}`;
    detail = `Λείπουν περίπου ${money(round(-result.lowest.closing))} στο χειρότερο σημείο (${monthLabel(result.lowest.month)}).`;
  } else {
    const below = result.rows.find((r) => r.cash.closing < cashFloor);
    const bankBelow = result.rows.find((r) => r.bank.closing < 0);
    if (below) {
      const need = round(cashFloor - result.cash.lowest.closing);
      const bankAfter = result.bank.lowest.closing - need;
      tone = "warn";
      title = "Βγαίνει συνολικά — αλλά στενεύουν τα μετρητά";
      detail = `Τα μετρητά πέφτουν στα ${money(result.cash.lowest.closing)} (${monthLabel(result.cash.lowest.month)}). Για να μένουν πάνω από ${money(cashFloor)} (3 μήνες καθημερινά), χρειάζεται μεταφορά ${money(need)} από την τράπεζα έως ${monthLong(below.month)}.${bankAfter < 0 ? " Η τράπεζα όμως δεν φτάνει γι’ αυτό." : ` Η τράπεζα μένει τουλάχιστον ${money(bankAfter)}.`}`;
      if (bankAfter >= 0) fix = { month: below.month, amount: need };
    } else if (bankBelow) {
      tone = "warn";
      title = "Βγαίνει συνολικά — αλλά τελειώνουν οι τράπεζες";
      detail = `Οι τράπεζες πάνε μείον ${monthLong(bankBelow.month)}. Χρειάζεται κατάθεση ${money(round(-result.bank.lowest.closing))} μετρητών.`;
      fix = { month: bankBelow.month, amount: -round(-result.bank.lowest.closing) };
    } else {
      title = "Βγαίνει";
      detail = `Χαμηλότερο σύνολο ${money(result.lowest.closing)} (${monthLabel(result.lowest.month)}) · μετρητά τουλάχιστον ${money(result.cash.lowest.closing)} · σε ${MONTHS} μήνες ${money(result.endBalance)}.`;
    }
  }
  const box = { ok: "border-sage-strong bg-sage/40", warn: "border-amber-ink/30 bg-amber-bg", bad: "border-red-ink/30 bg-red-bg" }[tone];
  const ink = { ok: "text-sage-ink", warn: "text-amber-ink", bad: "text-red-ink" }[tone];
  return (
    <div className={`rounded-lg border p-5 ${box}`}>
      <div className="text-xs uppercase tracking-wide text-ink-muted">Βγαίνει το πλάνο;</div>
      <div className={`mt-1 text-xl font-semibold ${ink}`}>{tone === "ok" ? "✓ " : "⚠ "}{title}</div>
      <div className="mt-1 text-sm text-ink-muted">{detail}</div>
      {fix && (
        <button type="button" onClick={() => onTry(fix)} className="mt-3 rounded-md border border-line bg-surface px-3 py-1.5 text-sm hover:bg-bg">
          Δοκίμασε τη μεταφορά
        </button>
      )}
    </div>
  );
}

// One month, one line: where each pool ends, and the month's change under it.
// Click to see what comes in and goes out.
function MonthLine({ r, buffer }: { r: Row; buffer: number }) {
  const cashNet = r.cash.inflow + r.cash.financing - r.cash.outflow - r.cash.personal - r.cash.interest + r.cash.transfer;
  const bankNet = r.bank.inflow + r.bank.financing - r.bank.outflow - r.bank.personal - r.bank.interest + r.bank.transfer;
  const cell = (end: number, net: number, b?: number) => (
    <div className="text-right">
      <div className={`tabular-nums font-medium ${tone(end, b)}`}>{money(end)}</div>
      <div className={`text-xs tabular-nums ${net < 0 ? "text-red-ink/80" : "text-sage-ink"}`}>{signed(net)}</div>
    </div>
  );
  const part = (title: string, p: Row["cash"]) => (
    <div className="space-y-1">
      <div className="text-xs uppercase tracking-wide text-ink-muted">{title}</div>
      {p.inflow > 0 && <div className="flex justify-between"><span>Εισπράξεις</span><span className="tabular-nums text-sage-ink">+{eur.format(Math.round(p.inflow))}</span></div>}
      {p.financing > 0 && <div className="flex justify-between"><span>Χρηματοδότηση</span><span className="tabular-nums text-sage-ink">+{eur.format(Math.round(p.financing))}</span></div>}
      {p.outflow > 0 && <div className="flex justify-between"><span>Πληρωμές</span><span className="tabular-nums">−{eur.format(Math.round(p.outflow))}</span></div>}
      {p.personal > 0 && <div className="flex justify-between"><span>Προσωπικά</span><span className="tabular-nums">−{eur.format(Math.round(p.personal))}</span></div>}
      {p.transfer !== 0 && <div className="flex justify-between"><span>Μεταφορά</span><span className="tabular-nums">{signed(p.transfer)}</span></div>}
      {p.interest > 0 && <div className="flex justify-between"><span>Τόκοι</span><span className="tabular-nums">−{eur.format(Math.round(p.interest))}</span></div>}
    </div>
  );
  return (
    <details className="group border-t border-line first:border-t-0">
      <summary className="grid cursor-pointer list-none grid-cols-[6rem_1fr_1fr_1fr] items-center gap-3 py-3 hover:bg-bg/60">
        <span className="text-sm font-medium capitalize">{monthLabel(r.month)}</span>
        {cell(r.cash.closing, cashNet)}
        {cell(r.bank.closing, bankNet)}
        {cell(r.closing, cashNet + bankNet, buffer)}
      </summary>
      <div className="mb-3 grid grid-cols-1 gap-4 rounded-md bg-bg/60 p-3 text-sm sm:grid-cols-2">
        {part("Μετρητά", r.cash)}
        {part("Τράπεζες", r.bank)}
      </div>
    </details>
  );
}

export function ScenarioPanel({
  start, opening, buffer, personal, daily, bankTarget, flows, levers, delayable, construction,
}: {
  start: string;
  opening: { cash: number; bank: number };
  buffer: number;
  personal: { cash: number; bank: number };
  // Recorded daily spending: monthly average and heaviest month (null if none yet).
  daily: { months: string[]; average: { cash: number; bank: number }; highest: { cash: number; bank: number } } | null;
  // What the bank wants in our accounts by a date before it lends (ίδια συμμετοχή).
  bankTarget: { amount: number; month: string; label: string } | null;
  flows: Flow[];
  levers: Lever[];
  delayable: Flow[];
  construction: { label: string; from: string; to: string } | null;
}) {
  const months = monthsFrom(start, MONTHS);
  const inflowLevers = levers.filter((l) => l.kind === "inflow");
  const forecastLevers = levers.filter((l) => l.kind === "forecast" && !l.group);
  const groups = [...new Set(levers.flatMap((l) => (l.kind === "forecast" && l.group ? [l.group] : [])))];
  const hasLoan = levers.some((l) => l.kind === "loan");

  const base: Choices = useMemo(
    () => ({
      on: Object.fromEntries([
        ...inflowLevers.map((l) => [l.id, l.kind === "inflow" && l.certain]),
        ...levers.filter((l) => l.kind === "forecast" && l.defaultOn).map((l) => [l.id, true]),
      ]),
      inflowMonth: Object.fromEntries(inflowLevers.map((l) => [l.id, l.month < start ? start : l.month])),
      delay: {},
      personalCash: personal.cash,
      personalBank: personal.bank,
      weightInflows: true,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  // The scenarios discussed with the user, one button each. Each starts from
  // "only certain" and switches on what the name says.
  const ids = (pick: (l: Lever) => boolean) => Object.fromEntries(levers.filter(pick).map((l) => [l.id, true]));
  const isStudy = (l: Lever) => l.kind === "forecast" && !l.group && !l.items;
  const isSeries = (l: Lever) => l.kind === "forecast" && !l.group && !!l.items;
  const isUncertain = (l: Lever) => l.kind === "inflow" && !l.certain;
  const isSamino = (l: Lever) => l.kind === "inflow" && /Σαμινό/.test(l.label);
  const isContract = (l: Lever) => l.kind === "forecast" && l.group === "Προσύμφωνο Λαζαράκη";
  const off = (pick: (l: Lever) => boolean) => Object.fromEntries(levers.filter(pick).map((l) => [l.id, false]));
  const avgDaily = daily ? { personalCash: daily.average.cash, personalBank: daily.average.bank } : {};
  const worstDaily = daily ? { personalCash: Math.round(daily.highest.cash), personalBank: Math.round(daily.highest.bank) } : avgDaily;
  const presets: { label: string; choices: Choices }[] = [
    { label: "Μόνο σίγουρα", choices: base },
    { label: "+ Μελετητές Λαζαράκη", choices: { ...base, on: { ...base.on, ...ids(isStudy) } } },
    { label: "+ Ρυθμίσεις ιδιοκτητών", choices: { ...base, on: { ...base.on, ...ids(isStudy), ...ids(isSeries) } } },
    { label: "Χωρίς προσύμφωνο Λαζαράκη", choices: { ...base, on: { ...base.on, ...off(isContract) } } },
    ...(daily ? [{ label: `Καθημερινά: μέσος όρος ${daily.months.map((m) => monthLabel(m)).join("–")}`, choices: { ...base, ...avgDaily } }] : []),
    { label: "Χωρίς δάνειο, χωρίς Σαμινό", choices: { ...base, on: { ...base.on, ...off(isSamino) } } },
    { label: "Με δάνειο, χωρίς Σαμινό", choices: { ...base, on: { ...base.on, ...ids(isStudy), ...off(isSamino), "bank-loan": true } } },
    { label: "Έρχονται Άλμπερτ & Ψυρρή", choices: { ...base, on: { ...base.on, ...ids(isUncertain) } } },
    { label: "Με δάνειο & κατασκευή", choices: { ...base, on: { ...base.on, ...ids(isStudy), ...ids(isSeries), "bank-loan": true } } },
    { label: "Δύσκολο: όλα τα έξοδα, χωρίς αβέβαια έσοδα", choices: { ...base, ...worstDaily, on: { ...base.on, ...ids(isStudy), ...ids(isSeries) } } },
    { label: "Όλα μέσα", choices: { ...base, on: ids(() => true) } },
  ];
  const [choices, setChoices] = useState<Choices>(base);
  const [preset, setPreset] = useState<string | null>(presets[0].label);
  const [view, setView] = useState<View>("total");
  const set = (patch: Partial<Choices>) => {
    setPreset(null);
    setChoices((c) => ({ ...c, ...patch }));
  };

  const results = useMemo(() => {
    const run = (c: Choices) => computeScenario({ start, months: MONTHS, opening, buffer, flows, levers, choices: c });
    return {
      mine: run(choices),
      certain: run(base),
      loan: run({ ...base, on: { ...base.on, "bank-loan": true } }),
      all: run({ ...base, on: Object.fromEntries(levers.map((l) => [l.id, true])) }),
    } as Record<"mine" | "certain" | "loan" | "all", ScenarioResult>;
  }, [choices, base, start, opening, buffer, flows, levers]);
  const result = results.mine;
  const v = valueOf(view);
  const chartData = months.map((m, i) => ({
    month: monthLabel(m),
    ...Object.fromEntries(LINES.map((l) => [l.key, Math.round(v(results[l.key].rows[i]))])),
  }));

  const warn = result.cash.firstNegative || result.bank.firstNegative;

  return (
    <div className="flex flex-col gap-6">
      {/* 0. Έτοιμα σενάρια */}
      <section className="flex flex-wrap gap-2">
        {presets.map((p) => (
          <button key={p.label} type="button" onClick={() => { setChoices(p.choices); setPreset(p.label); }}
            className={`rounded-full border px-3 py-1.5 text-sm ${preset === p.label ? "border-ink bg-ink text-surface" : "border-line bg-surface text-ink-muted hover:text-ink"}`}>
            {p.label}
          </button>
        ))}
      </section>

      <Verdict result={result} cashFloor={Math.round(choices.personalCash * 3)} onTry={(t) => set({ transfer: t })} />
      {bankTarget && (() => {
        const row = result.rows.find((r) => r.month === bankTarget.month);
        if (!row) return null;
        const gap = bankTarget.amount - row.bank.closing;
        return (
          <div className={`-mt-3 rounded-lg border px-5 py-3 text-sm ${gap <= 0 ? "border-sage-strong bg-sage/40" : "border-amber-ink/30 bg-amber-bg"}`}>
            <span className="font-medium">{gap <= 0 ? "✓" : "⚠"} {bankTarget.label}: </span>
            τράπεζες στο τέλος {monthLong(bankTarget.month)} <span className="tabular-nums font-medium">{money(row.bank.closing)}</span> · στόχος {money(bankTarget.amount)}
            {gap > 0 && <> · <span className="font-medium text-amber-ink">λείπουν {money(gap)}</span></>}
          </div>
        );
      })()}

      {/* 1. Τρία νούμερα */}
      <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat label="Μετρητά" today={opening.cash} low={result.cash.lowest.closing} lowMonth={result.cash.lowest.month} end={result.cash.endBalance} />
        <Stat label="Τράπεζες" today={opening.bank} low={result.bank.lowest.closing} lowMonth={result.bank.lowest.month} end={result.bank.endBalance} />
        <Stat label="Σύνολο" today={opening.cash + opening.bank} low={result.lowest.closing} lowMonth={result.lowest.month} end={result.endBalance} buffer={buffer} />
      </section>
      {warn && (
        <div className="-mt-3 text-sm text-red-ink">
          ⚠ {result.cash.firstNegative && <>Τα μετρητά τελειώνουν {monthLong(result.cash.firstNegative)}. </>}
          {result.bank.firstNegative && <>Οι τράπεζες τελειώνουν {monthLong(result.bank.firstNegative)}.</>}
          {!result.firstNegative && " Συνολικά φτάνουν — θέλει μεταφορά ανάμεσα σε μετρητά και τράπεζα."}
        </div>
      )}

      {/* 3. Το διάγραμμα -- μένει πάνω (sticky) ενώ κυλάνε οι διακόπτες από κάτω */}
      <section className="z-10 rounded-lg border border-line bg-surface p-5 shadow-sm md:sticky md:top-2">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold">{preset ?? "Οι επιλογές μου"}</h2>
          <div className="flex rounded-md bg-bg p-0.5 text-xs">
            {(Object.keys(VIEW_LABEL) as View[]).map((k) => (
              <button key={k} type="button" onClick={() => setView(k)} className={`rounded px-3 py-1 ${view === k ? "bg-surface font-medium shadow-sm" : "text-ink-muted"}`}>
                {VIEW_LABEL[k]}
              </button>
            ))}
          </div>
        </div>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid stroke="var(--color-line)" vertical={false} />
              <XAxis dataKey="month" tick={{ fontSize: 11, fill: "var(--color-ink-faint)" }} tickLine={false} axisLine={false} />
              <YAxis tickFormatter={short} tick={{ fontSize: 11, fill: "var(--color-ink-faint)" }} tickLine={false} axisLine={false} width={44} />
              {view === "total" && <ReferenceLine y={buffer} stroke="var(--color-amber-ink)" strokeDasharray="3 4" strokeOpacity={0.6} />}
              <ReferenceLine y={0} stroke="var(--color-ink-faint)" strokeOpacity={0.6} />
              <Tooltip
                formatter={(val, name) => [money(Number(val)), LINES.find((l) => l.key === name)?.label ?? String(name)]}
                contentStyle={{ fontSize: 12, borderRadius: 8, borderColor: "var(--color-line)" }}
                cursor={{ stroke: "var(--color-line-strong)" }}
              />
              {LINES.map((l) => (
                <Line key={l.key} type="monotone" dataKey={l.key} stroke={l.color} strokeWidth={l.width} strokeDasharray={l.dash}
                  dot={false} activeDot={{ r: 5, stroke: "#fff", strokeWidth: 2 }} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
        {/* Υπόμνημα = και πίνακας: κάθε σενάριο με το χαμηλότερο και το τέλος του */}
        <div className="mt-4 grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
          {LINES.map((l) => {
            const rows = results[l.key].rows;
            const low = lowestOf(rows, v);
            return (
              <div key={l.key} className="flex items-center gap-3">
                <svg width="22" height="8" aria-hidden className="shrink-0">
                  <line x1="0" y1="4" x2="22" y2="4" stroke={l.color} strokeWidth={l.width} strokeDasharray={l.dash} />
                </svg>
                <span className={l.key === "mine" ? "font-medium" : ""}>{l.label}</span>
                <span className="ml-auto text-xs text-ink-muted">
                  χαμ. <span className={`tabular-nums ${tone(v(low))}`}>{money(v(low))}</span> · τέλος <span className={`tabular-nums ${tone(v(rows[MONTHS - 1]))}`}>{money(v(rows[MONTHS - 1]))}</span>
                </span>
              </div>
            );
          })}
        </div>
      </section>

      {/* 5. Επιλογές */}
      <section className="rounded-lg border border-line bg-surface p-5 text-sm">
        <h2 className="mb-4 text-sm font-semibold">Οι επιλογές μου</h2>
        <div className="space-y-6">
          <Group title="Μεταφορά από την τράπεζα στα μετρητά">
            <div className="flex flex-wrap items-center gap-3 py-1.5">
              <input type="number" step={1000} className="w-28 rounded-md border border-line bg-surface px-2 py-1 text-right tabular-nums"
                value={choices.transfer?.amount ?? 0}
                onChange={(e) => set({ transfer: { month: choices.transfer?.month ?? start, amount: Number(e.target.value) || 0 } })} />
              <span className="text-ink-faint">€ τον</span>
              <select className="rounded-md border border-line bg-surface px-2 py-1 text-xs" value={choices.transfer?.month ?? start}
                onChange={(e) => set({ transfer: { month: e.target.value, amount: choices.transfer?.amount ?? 0 } })}>
                {months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
              </select>
              <span className="text-xs text-ink-faint">μόνο μετακίνηση — το σύνολο δεν αλλάζει</span>
            </div>
          </Group>

          <Group title="Χρήματα που περιμένουμε">
            {inflowLevers.map((l) =>
              l.kind !== "inflow" ? null : (
                <Option key={l.id} checked={!!choices.on[l.id]} onChange={(c) => set({ on: { ...choices.on, [l.id]: c } })}
                  label={l.label} amount={l.amount}
                  tags={[l.pool === "cash" ? "μετρητά" : "τράπεζα", !l.certain ? "αβέβαιο" : "", l.debt ? "δάνειο" : ""]}>
                  <select className="rounded-md border border-line bg-surface px-2 py-1 text-xs" value={choices.inflowMonth[l.id]}
                    onChange={(e) => set({ inflowMonth: { ...choices.inflowMonth, [l.id]: e.target.value } })} disabled={!choices.on[l.id]}>
                    {months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
                  </select>
                </Option>
              ),
            )}
          </Group>

          {hasLoan && (
            <Group title="Χρηματοδότηση">
              <Option checked={!!choices.on["bank-loan"]} onChange={(c) => set({ on: { ...choices.on, "bank-loan": c } })}
                label="Εγκρίνεται το τραπεζικό δάνειο — και ξεκινά η κατασκευή" tags={["εκταμιεύσεις, τόκοι χάριτος, φάσεις κατασκευής"]} />
            </Group>
          )}

          {groups.map((g) => (
            <Group key={g} title={g}>
              {levers.map((l) =>
                l.kind !== "forecast" || l.group !== g ? null : (
                  <Option key={l.id} checked={!!choices.on[l.id]} onChange={(c) => set({ on: { ...choices.on, [l.id]: c } })}
                    label={l.label} amount={l.amount}
                    tags={new Set((l.items ?? []).map((i) => i.month)).size > 1 ? [
                      `τον μήνα, από ${monthLabel(addMonths(l.month, choices.delay[l.id] ?? 0))}`,
                      l.pool === "cash" ? "μετρητά" : "τράπεζα",
                    ] : [
                      monthLabel(addMonths(l.month, choices.delay[l.id] ?? 0)),
                      ...(["cash", "bank"] as const).map((p) => {
                        const s = (l.items ?? []).filter((i) => i.pool === p).reduce((a, i) => a + i.amount, 0);
                        return s ? `${p === "cash" ? "μετρητά" : "τράπεζα"} ${money(s)}` : "";
                      }),
                    ]}>
                    <select className="rounded-md border border-line bg-surface px-2 py-1 text-xs" value={choices.delay[l.id] ?? 0}
                      onChange={(e) => set({ delay: { ...choices.delay, [l.id]: Number(e.target.value) } })}>
                      {[0, 1, 2, 3, 6].map((n) => <option key={n} value={n}>{n === 0 ? "στην ώρα της" : `+${n} μήνες`}</option>)}
                    </select>
                  </Option>
                ),
              )}
            </Group>
          ))}

          {forecastLevers.length > 0 && (
            <Group title="Προβλέψεις — εκτιμήσεις, όχι υπογεγραμμένα">
              {forecastLevers.map((l) =>
                l.kind !== "forecast" ? null : (
                  <Option key={l.id} checked={!!choices.on[l.id]} onChange={(c) => set({ on: { ...choices.on, [l.id]: c } })}
                    label={l.label} amount={l.amount}
                    tags={[l.items ? `τον μήνα, από ${monthLabel(l.month)}` : monthLabel(l.month), l.pool === "cash" ? "μετρητά" : "τράπεζα"]} />
                ),
              )}
            </Group>
          )}

          {delayable.length > 0 && (
            <Group title="Αν αργήσει μια μεγάλη πληρωμή">
              {delayable.map((f) => (
                <div key={f.id} className="flex flex-wrap items-center gap-3 py-1.5">
                  <span className="min-w-0 flex-1 truncate">{f.label}</span>
                  <span className="tabular-nums text-ink-muted">{money(f.amount)}</span>
                  <span className="w-14 text-xs text-ink-faint">{monthLabel(f.month)}</span>
                  <select className="rounded-md border border-line bg-surface px-2 py-1 text-xs" value={choices.delay[f.id] ?? 0}
                    onChange={(e) => set({ delay: { ...choices.delay, [f.id]: Number(e.target.value) } })}>
                    {[0, 1, 2, 3, 6].map((n) => <option key={n} value={n}>{n === 0 ? "στην ώρα της" : `+${n} μήνες`}</option>)}
                  </select>
                </div>
              ))}
            </Group>
          )}

          <Group title="Προσωπικά έξοδα τον μήνα">
            <div className="flex flex-wrap gap-6 py-1.5">
              {([["μετρητά", "personalCash"], ["κάρτα", "personalBank"]] as const).map(([label, key]) => (
                <label key={key} className="flex items-center gap-2">
                  <span className="text-ink-muted">{label}</span>
                  <input type="number" step={250} min={0} className="w-24 rounded-md border border-line bg-surface px-2 py-1 text-right tabular-nums"
                    value={choices[key]} onChange={(e) => set({ [key]: Number(e.target.value) || 0 })} />
                  <span className="text-ink-faint">€</span>
                </label>
              ))}
            </div>
          </Group>
        </div>
      </section>

      {/* 2. Κατασκευή */}
      {construction && (
        <ConstructionBox c={construction} result={choices.on["bank-loan"] ? results.mine : results.loan} withMine={!!choices.on["bank-loan"]} buffer={buffer} />
      )}

      {/* 4. Ανά μήνα */}
      <section className="rounded-lg border border-line bg-surface px-5 py-3">
        <div className="grid grid-cols-[6rem_1fr_1fr_1fr] gap-3 pb-2 pt-1 text-xs uppercase tracking-wide text-ink-muted">
          <span>Μήνας</span>
          <span className="text-right">Μετρητά</span>
          <span className="text-right">Τράπεζες</span>
          <span className="text-right">Σύνολο</span>
        </div>
        {result.rows.map((r) => <MonthLine key={r.month} r={r} buffer={buffer} />)}
        <p className="pt-2 text-xs text-ink-faint">Υπόλοιπο στο τέλος του μήνα, και από κάτω η αλλαγή του μήνα. Πατήστε έναν μήνα για λεπτομέρειες.</p>
      </section>

    </div>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-xs uppercase tracking-wide text-ink-muted">{title}</div>
      <div className="divide-y divide-line">{children}</div>
    </div>
  );
}

function Option({ checked, onChange, label, amount, tags, children }: {
  checked: boolean; onChange: (c: boolean) => void; label: string; amount?: number; tags?: string[]; children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 py-1.5">
      <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
        <input type="checkbox" className="accent-[#2a78d6]" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <span className="truncate">{label}</span>
        {tags?.filter(Boolean).map((t) => <span key={t} className="rounded bg-bg px-1.5 py-0.5 text-[11px] text-ink-muted">{t}</span>)}
      </label>
      {amount != null && <span className="tabular-nums text-ink-muted">{money(amount)}</span>}
      {children}
    </div>
  );
}
