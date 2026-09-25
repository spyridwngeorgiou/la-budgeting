"use client";

import { useState } from "react";
import Link from "next/link";
import { Badge, Button, Field, Input, Label } from "@/components/ui";
import { formatMoney, formatDate } from "@/lib/format";
import { assertAccountBalance } from "./actions";

// One row of v_balance_checks (0035): a real balance on a date, and whether
// the movements recorded for the period leading up to it explain it.
export interface BalanceCheck {
  id: string;
  as_of_date: string;
  asserted_balance: number;
  from_import: boolean;
  period_start: string;
  period_start_balance: number;
  period_start_source: "check" | "opening" | "app";
  period_income: number;
  period_income_n: number;
  period_expense: number;
  period_expense_n: number;
  expected_balance: number;
  period_gap: number;
  total_gap: number;
}

const START_LABEL = {
  check: "Πραγματικό υπόλοιπο",
  opening: "Υπόλοιπο έναρξης",
  app: "Υπόλοιπο εφαρμογής (μη επιβεβαιωμένο)",
} as const;

const ok = (gap: number) => Math.abs(gap) < 1;

// A period-breakdown line: label left, monospace figure right -- the same
// grammar OnePagerRow uses everywhere else in the app.
function BreakdownRow({ label, value, emphasis, tone }: { label: string; value: string; emphasis?: boolean; tone?: string }) {
  return (
    <div className={`flex items-baseline justify-between gap-3 py-0.5 ${emphasis ? "font-semibold text-ink" : "text-ink-muted"}`}>
      <span>{label}</span>
      <span className={`font-mono text-sm tabular-nums ${tone ?? ""}`}>{value}</span>
    </div>
  );
}

// Positive gap = there is MORE money in reality than the app knows about:
// an income wasn't recorded (or an expense was recorded that never happened).
// Negative = LESS money than the app thinks: an expense wasn't recorded.
function GapHeadline({ gap, isCash, gapPeriods }: { gap: number; isCash: boolean; gapPeriods: BalanceCheck[] }) {
  if (ok(gap)) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-sage-strong/50 bg-sage/30 px-3 py-2.5">
        <Badge tone="green">Συμφωνεί</Badge>
        <span className="text-sm text-sage-ink">Δεν λείπουν κινήσεις</span>
      </div>
    );
  }
  const where = isCash ? "στο ταμείο" : "στην τράπεζα";
  return (
    <div className="rounded-lg border border-red-ink/30 bg-red-bg px-3 py-2.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-semibold text-red-ink">{gap < 0 ? "Λείπουν έξοδα" : "Λείπουν έσοδα"}</span>
        <span className="font-mono text-lg font-bold tabular-nums text-red-ink">{formatMoney(Math.abs(gap))}</span>
      </div>
      <p className="mt-0.5 text-xs text-red-ink/80">
        {gap < 0
          ? `Υπάρχουν ${formatMoney(Math.abs(gap))} λιγότερα ${where} από όσα δείχνει η εφαρμογή — κάποια πληρωμή δεν έχει περαστεί.`
          : `Υπάρχουν ${formatMoney(gap)} περισσότερα ${where} από όσα δείχνει η εφαρμογή — κάποια είσπραξη δεν έχει περαστεί (ή περάστηκε πληρωμή που δεν έγινε).`}
      </p>
      {gapPeriods.length > 0 && (
        <p className="mt-1.5 text-xs font-medium text-red-ink">
          Η διαφορά προέκυψε: {gapPeriods.map((c) => `${formatDate(c.period_start)} → ${formatDate(c.as_of_date)}`).join(", ")}
        </p>
      )}
    </div>
  );
}

function PeriodBreakdown({ check, accountId }: { check: BalanceCheck; accountId: string }) {
  return (
    <div className="rounded-lg border border-line bg-bg/60 px-3 py-2.5">
      <div className="mb-1.5 flex items-center justify-between border-b border-line pb-1.5">
        <span className="text-xs font-semibold text-ink">
          {formatDate(check.period_start)} → {formatDate(check.as_of_date)}
        </span>
        {check.from_import && <Badge tone="neutral">από Excel</Badge>}
      </div>
      <BreakdownRow label={START_LABEL[check.period_start_source]} value={formatMoney(check.period_start_balance)} />
      <BreakdownRow label={`+ Έσοδα (${check.period_income_n})`} value={formatMoney(check.period_income)} />
      <BreakdownRow label={`− Έξοδα (${check.period_expense_n})`} value={formatMoney(check.period_expense)} />
      <BreakdownRow label="= Αναμενόμενο υπόλοιπο" value={formatMoney(check.expected_balance)} emphasis />
      <div className="my-1 border-t border-line" />
      <BreakdownRow label="Πραγματικό υπόλοιπο" value={formatMoney(check.asserted_balance)} emphasis />
      <BreakdownRow
        label="Διαφορά περιόδου"
        value={ok(check.period_gap) ? "0,00 €" : `${check.period_gap > 0 ? "+" : "−"}${formatMoney(Math.abs(check.period_gap))}`}
        emphasis
        tone={ok(check.period_gap) ? "text-sage-ink" : "text-red-ink"}
      />
      <Link
        href={`/transactions?account_id=${accountId}&from=${check.period_start}&to=${check.as_of_date}`}
        className="mt-1.5 inline-block text-xs text-ink-muted underline hover:text-ink"
      >
        Κινήσεις της περιόδου →
      </Link>
    </div>
  );
}

export function BalanceAssertion({
  accountId,
  checks,
  expectedToday,
  defaultFrom,
  isCash,
}: {
  accountId: string;
  checks: BalanceCheck[]; // newest first
  expectedToday: number;
  defaultFrom: string;
  isCash: boolean;
}) {
  const [open, setOpen] = useState(checks.length === 0);
  const [showHistory, setShowHistory] = useState(false);
  const latest = checks[0];
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="mt-3 flex flex-col gap-3 border-t border-line pt-3">
      {latest ? (
        <>
          <div className="flex items-center justify-between text-xs text-ink-faint">
            <span>Τελευταίος έλεγχος {formatDate(latest.as_of_date)}</span>
          </div>
          <GapHeadline gap={latest.total_gap} isCash={isCash} gapPeriods={checks.filter((c) => !ok(c.period_gap))} />
          {/* Periods where a gap arose are always shown; clean older ones fold away. */}
          {checks
            .filter((c, i) => showHistory || i === 0 || !ok(c.period_gap))
            .map((c) => (
              <PeriodBreakdown key={c.id} check={c} accountId={accountId} />
            ))}
          {checks.some((c, i) => i > 0 && ok(c.period_gap)) && (
            <button type="button" onClick={() => setShowHistory(!showHistory)} className="self-start text-xs text-ink-faint underline hover:text-ink">
              {showHistory
                ? "Απόκρυψη παλαιότερων ελέγχων"
                : `Παλαιότεροι έλεγχοι χωρίς διαφορά (${checks.filter((c, i) => i > 0 && ok(c.period_gap)).length})`}
            </button>
          )}
        </>
      ) : (
        <div className="rounded-lg border border-amber-ink/30 bg-amber-bg px-3 py-2.5 text-xs text-amber-ink">
          Δεν έχει γίνει έλεγχος. Βάλτε το πραγματικό υπόλοιπο από {isCash ? "την καταμέτρηση του ταμείου" : "το e-banking"} για
          να δείτε αν λείπουν κινήσεις.
        </div>
      )}

      {open ? (
        <form
          action={async (formData) => {
            await assertAccountBalance(accountId, formData);
            setOpen(false);
          }}
          className="flex flex-col gap-3 rounded-lg border border-line bg-bg/60 p-3"
        >
          <div className="text-xs text-ink-muted">
            Η εφαρμογή περιμένει σήμερα <span className="font-mono font-medium text-ink">{formatMoney(expectedToday)}</span>
          </div>
          {/* Stacked, not a 3-up grid: these cards live in a 3-column page
              grid, so a viewport breakpoint here doesn't know the CARD is
              narrow and clips the date inputs. */}
          <div className="flex flex-col gap-2.5">
            <Field>
              <Label>Πραγματικό υπόλοιπο</Label>
              <Input type="number" step="0.01" name="asserted_balance" placeholder="0,00" required />
            </Field>
            <div className="grid grid-cols-2 gap-2.5">
              <Field>
                <Label>στις</Label>
                <Input type="date" name="as_of_date" defaultValue={today} max={today} required />
              </Field>
              <Field>
                <Label>Έλεγχος από</Label>
                <Input type="date" name="period_start" defaultValue={defaultFrom} />
              </Field>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            {checks.length > 0 && (
              <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
                Άκυρο
              </Button>
            )}
            <Button type="submit">Έλεγχος</Button>
          </div>
        </form>
      ) : (
        <button type="button" onClick={() => setOpen(true)} className="self-start text-xs text-ink-muted underline hover:text-ink">
          Νέος έλεγχος με πραγματικό υπόλοιπο
        </button>
      )}
    </div>
  );
}
