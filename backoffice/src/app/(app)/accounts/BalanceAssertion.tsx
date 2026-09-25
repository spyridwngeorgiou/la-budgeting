"use client";

import { useState } from "react";
import Link from "next/link";
import { Badge, Button, Input } from "@/components/ui";
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

// Positive gap = there is MORE money in reality than the app knows about:
// an income wasn't recorded (or an expense was recorded that never happened).
// Negative = LESS money than the app thinks: an expense wasn't recorded.
function GapHeadline({ gap, isCash, gapPeriods }: { gap: number; isCash: boolean; gapPeriods: BalanceCheck[] }) {
  if (ok(gap)) {
    return (
      <div className="rounded border border-sage-strong/50 bg-sage/30 px-2.5 py-1.5 text-sm font-medium text-sage-ink">
        Συμφωνεί — δεν λείπουν κινήσεις
      </div>
    );
  }
  const where = isCash ? "στο ταμείο" : "στην τράπεζα";
  return (
    <div className="rounded border border-red-ink/40 bg-red-bg px-2.5 py-1.5 text-red-ink">
      <div className="text-base font-semibold">
        {gap < 0 ? "Λείπουν έξοδα" : "Λείπουν έσοδα"}: {formatMoney(Math.abs(gap))}
      </div>
      <div className="text-xs">
        {gap < 0
          ? `Υπάρχουν ${formatMoney(Math.abs(gap))} λιγότερα ${where} από όσα δείχνει η εφαρμογή — κάποια πληρωμή δεν έχει περαστεί.`
          : `Υπάρχουν ${formatMoney(gap)} περισσότερα ${where} από όσα δείχνει η εφαρμογή — κάποια είσπραξη δεν έχει περαστεί (ή περάστηκε πληρωμή που δεν έγινε).`}
      </div>
      {gapPeriods.length > 0 && (
        <div className="mt-1 text-xs font-medium">
          Η διαφορά προέκυψε: {gapPeriods.map((c) => `${formatDate(c.period_start)} → ${formatDate(c.as_of_date)}`).join(", ")}
        </div>
      )}
    </div>
  );
}

function PeriodBreakdown({ check, accountId }: { check: BalanceCheck; accountId: string }) {
  const Row = ({ label, value, strong, tone }: { label: string; value: string; strong?: boolean; tone?: string }) => (
    <div className={`flex justify-between gap-2 ${strong ? "font-medium text-ink" : ""} ${tone ?? ""}`}>
      <span>{label}</span>
      <span className="font-mono tabular-nums">{value}</span>
    </div>
  );
  return (
    <div className="flex flex-col gap-0.5 rounded border border-line px-2.5 py-2 text-xs text-ink-muted">
      <div className="mb-1 flex items-center justify-between">
        <span className="font-medium text-ink">
          {formatDate(check.period_start)} → {formatDate(check.as_of_date)}
        </span>
        {check.from_import && <Badge tone="neutral">από Excel</Badge>}
      </div>
      <Row label={`${START_LABEL[check.period_start_source]} ${formatDate(check.period_start)}`} value={formatMoney(check.period_start_balance)} />
      <Row label={`+ Έσοδα που περάστηκαν (${check.period_income_n})`} value={formatMoney(check.period_income)} />
      <Row label={`− Έξοδα που περάστηκαν (${check.period_expense_n})`} value={formatMoney(check.period_expense)} />
      <Row label="= Αναμενόμενο υπόλοιπο" value={formatMoney(check.expected_balance)} strong />
      <Row label="Πραγματικό υπόλοιπο" value={formatMoney(check.asserted_balance)} strong />
      <Row
        label="Διαφορά περιόδου"
        value={ok(check.period_gap) ? "0,00 €" : `${check.period_gap > 0 ? "+" : "−"}${formatMoney(Math.abs(check.period_gap))}`}
        strong
        tone={ok(check.period_gap) ? "text-sage-ink" : "text-red-ink"}
      />
      <Link
        href={`/transactions?account_id=${accountId}&from=${check.period_start}&to=${check.as_of_date}`}
        className="mt-1 underline"
      >
        Κινήσεις της περιόδου
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
    <div className="mt-2 flex flex-col gap-2 border-t border-line/60 pt-2">
      {latest ? (
        <>
          <div className="flex items-center justify-between text-xs text-ink-muted">
            <span>Έλεγχος {formatDate(latest.as_of_date)}</span>
          </div>
          <GapHeadline gap={latest.total_gap} isCash={isCash} gapPeriods={checks.filter((c) => !ok(c.period_gap))} />
          {/* Periods where a gap arose are always shown; clean older ones fold away. */}
          {checks
            .filter((c, i) => showHistory || i === 0 || !ok(c.period_gap))
            .map((c) => (
              <PeriodBreakdown key={c.id} check={c} accountId={accountId} />
            ))}
          {checks.some((c, i) => i > 0 && ok(c.period_gap)) && (
            <button type="button" onClick={() => setShowHistory(!showHistory)} className="text-left text-xs text-ink-faint underline">
              {showHistory
                ? "Απόκρυψη παλαιότερων ελέγχων"
                : `Παλαιότεροι έλεγχοι χωρίς διαφορά (${checks.filter((c, i) => i > 0 && ok(c.period_gap)).length})`}
            </button>
          )}
        </>
      ) : (
        <p className="text-xs text-amber-ink">
          Δεν έχει γίνει έλεγχος. Βάλτε το πραγματικό υπόλοιπο από {isCash ? "την καταμέτρηση του ταμείου" : "το e-banking"} για
          να δείτε αν λείπουν κινήσεις.
        </p>
      )}

      {open ? (
        <form
          action={async (formData) => {
            await assertAccountBalance(accountId, formData);
            setOpen(false);
          }}
          className="flex flex-col gap-1.5 rounded bg-bg p-2"
        >
          <div className="text-xs text-ink-muted">
            Η εφαρμογή περιμένει σήμερα: <span className="font-mono text-ink">{formatMoney(expectedToday)}</span>
          </div>
          <label className="flex items-center justify-between gap-2 text-xs">
            <span>Πραγματικό υπόλοιπο</span>
            <Input type="number" step="0.01" name="asserted_balance" required className="!w-32 !py-1 text-xs" />
          </label>
          <label className="flex items-center justify-between gap-2 text-xs">
            <span>στις</span>
            <Input type="date" name="as_of_date" defaultValue={today} max={today} required className="!w-32 !py-1 text-xs" />
          </label>
          <label className="flex items-center justify-between gap-2 text-xs">
            <span>Έλεγχος κινήσεων από</span>
            <Input type="date" name="period_start" defaultValue={defaultFrom} className="!w-32 !py-1 text-xs" />
          </label>
          <div className="flex justify-end gap-1.5">
            {checks.length > 0 && (
              <Button type="button" variant="secondary" className="!px-2 !py-1 text-xs" onClick={() => setOpen(false)}>
                Άκυρο
              </Button>
            )}
            <Button type="submit" className="!px-2 !py-1 text-xs">
              Έλεγχος
            </Button>
          </div>
        </form>
      ) : (
        <button type="button" onClick={() => setOpen(true)} className="text-left text-xs text-ink-faint underline">
          Νέος έλεγχος με πραγματικό υπόλοιπο
        </button>
      )}
    </div>
  );
}
