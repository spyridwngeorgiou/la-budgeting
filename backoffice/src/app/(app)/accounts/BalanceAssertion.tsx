import Link from "next/link";
import { Badge, Notice, ReportHistory, SectionHeader, Stat, StatusDot, cn } from "@/components/ui";
import { formatMoney, formatDate } from "@/lib/format";
import { el } from "@/lib/i18n/el";
import { STATUS_LABEL, STATUS_TONE, isStale, okGap, statusOf } from "./status";

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

const periodHref = (accountId: string, c: BalanceCheck) =>
  `/transactions?account_id=${accountId}&from=${c.period_start}&to=${c.as_of_date}`;

// A period-breakdown line: label left, monospace figure right -- the same
// grammar OnePagerRow uses everywhere else in the app.
function BreakdownRow({ label, value, emphasis, tone }: { label: string; value: string; emphasis?: boolean; tone?: string }) {
  return (
    <div
      className={`flex items-baseline justify-between gap-3 border-b border-hairline py-1.5 text-small ${
        emphasis ? "font-medium text-ink" : "text-muted"
      }`}
    >
      <span>{label}</span>
      <span className={`num text-body ${tone ?? (emphasis ? "text-ink" : "text-text")}`}>{value}</span>
    </div>
  );
}

// Positive gap = there is MORE money in reality than the app knows about:
// an income wasn't recorded (or an expense was recorded that never happened).
// Negative = LESS money than the app thinks: an expense wasn't recorded.
function GapWarning({ gap, isCash, gapPeriods, accountId }: { gap: number; isCash: boolean; gapPeriods: BalanceCheck[]; accountId: string }) {
  const where = isCash ? "στο ταμείο" : "στην τράπεζα";
  return (
    <Notice tone="negative" as="div">
      <Stat
        label={gap < 0 ? "Λείπουν έξοδα" : "Λείπουν έσοδα"}
        value={<span className="text-negative">{formatMoney(Math.abs(gap))}</span>}
      />
      <p className="mt-1 text-small text-text">
        {gap < 0
          ? `Υπάρχουν ${formatMoney(Math.abs(gap))} λιγότερα ${where} από όσα δείχνει η εφαρμογή — κάποια πληρωμή δεν έχει περαστεί.`
          : `Υπάρχουν ${formatMoney(gap)} περισσότερα ${where} από όσα δείχνει η εφαρμογή — κάποια είσπραξη δεν έχει περαστεί (ή περάστηκε πληρωμή που δεν έγινε).`}
      </p>
      {gapPeriods.length > 0 && (
        <p className="mt-1.5 flex flex-wrap gap-x-3 text-small font-medium text-negative">
          <span>Η διαφορά προέκυψε:</span>
          {gapPeriods.map((c) => (
            <Link key={c.id} href={periodHref(accountId, c)} className="num underline underline-offset-4 hover:text-ink max-md:inline-flex max-md:min-h-11 max-md:items-center">
              {formatDate(c.period_start)} → {formatDate(c.as_of_date)}
            </Link>
          ))}
        </p>
      )}
    </Notice>
  );
}

function PeriodBreakdown({ check, accountId }: { check: BalanceCheck; accountId: string }) {
  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between gap-3 border-b border-hairline pb-1.5">
        <span className="num text-small font-medium text-ink">
          {formatDate(check.period_start)} → {formatDate(check.as_of_date)}
        </span>
        {check.from_import && <Badge tone="neutral">από Excel</Badge>}
      </div>
      <BreakdownRow label={START_LABEL[check.period_start_source]} value={formatMoney(check.period_start_balance)} />
      <BreakdownRow label={`+ Έσοδα (${check.period_income_n})`} value={formatMoney(check.period_income)} />
      <BreakdownRow label={`− Έξοδα (${check.period_expense_n})`} value={formatMoney(check.period_expense)} />
      <BreakdownRow label="= Αναμενόμενο υπόλοιπο" value={formatMoney(check.expected_balance)} emphasis />
      <div aria-hidden="true" className="h-3" />
      <BreakdownRow label="Πραγματικό υπόλοιπο" value={formatMoney(check.asserted_balance)} emphasis />
      <BreakdownRow
        label="Διαφορά περιόδου"
        value={okGap(check.period_gap) ? "0,00 €" : `${check.period_gap > 0 ? "+" : "−"}${formatMoney(Math.abs(check.period_gap))}`}
        emphasis
        tone={okGap(check.period_gap) ? "text-ink" : "text-negative"}
      />
      <Link
        href={periodHref(accountId, check)}
        className="mt-1 inline-flex min-h-11 items-center self-start text-small text-muted underline underline-offset-4 hover:text-ink md:min-h-8"
      >
        Κινήσεις της περιόδου →
      </Link>
    </div>
  );
}

// «Έλεγχοι υπολοίπου» on the account page, from the checks the page already
// loads (v_balance_checks, newest first): the last check's state, the
// «Λείπουν …» warning when the real balance and the app disagree, and every
// period's breakdown under «▸ Ιστορικό ελέγχων (N)». Read-only; a new check
// is the «Νέος έλεγχος» drawer (CheckDrawer). No hooks -- renders on the server.
export function BalanceChecks({
  accountId,
  checks,
  isCash,
  today,
}: {
  accountId: string;
  checks: BalanceCheck[];
  isCash: boolean;
  today: string;
}) {
  const { status, latest } = statusOf(checks);
  return (
    <section className="flex flex-col gap-3">
      <SectionHeader title={el.account.checks} />
      {!latest ? (
        <Notice tone="warning" size="small">
          Δεν έχει γίνει έλεγχος. Βάλτε το πραγματικό υπόλοιπο από {isCash ? "την καταμέτρηση του ταμείου" : "το e-banking"} για να
          δείτε αν λείπουν κινήσεις.
        </Notice>
      ) : (
        <>
          <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-small text-muted">
            <StatusDot tone={STATUS_TONE[status]} label={STATUS_LABEL[status]} />
            <span className={cn("num", isStale(latest.as_of_date, today) && "text-warning")}>
              {el.account.lastCheck} {formatDate(latest.as_of_date)}
            </span>
            <span>
              {el.account.asserted} <span className="num text-ink">{formatMoney(latest.asserted_balance)}</span>
            </span>
            {status === "ok" && <span>Δεν λείπουν κινήσεις</span>}
          </p>
          {status === "drift" && (
            <GapWarning
              gap={latest.total_gap}
              isCash={isCash}
              gapPeriods={checks.filter((c) => !okGap(c.period_gap))}
              accountId={accountId}
            />
          )}
          <ReportHistory title={el.account.checkHistory} count={checks.length} level={3}>
            <div className="flex flex-col gap-5">
              {checks.map((c) => (
                <PeriodBreakdown key={c.id} check={c} accountId={accountId} />
              ))}
            </div>
          </ReportHistory>
        </>
      )}
    </section>
  );
}
