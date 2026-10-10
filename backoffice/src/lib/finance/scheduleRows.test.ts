import { describe, it, expect } from "vitest";
import { computeLeaseSchedule, leaseMonthlyRows, type LeaseTerms } from "./lease";
import { leaseScheduleRows, loanScheduleRows, type LeaseRowLike, type LoanRowLike } from "./scheduleRows";
import { parseHorizon, parseScenario, parseScope } from "./forecastParams";

const terms: LeaseTerms = {
  baseMonthlyAmount: 6000,
  stampDutyPct: 0.03,
  stampDutySurchargePct: 0.2,
  escalationPct: 0.035,
  escalationFirstYear: 2,
  termYears: 3,
  stepUpsEscalate: false,
  stepUpsStampable: false,
};

describe("leaseMonthlyRows", () => {
  const schedule = computeLeaseSchedule(terms, []);

  it("one row per month of the term when rent starts with the lease", () => {
    const rows = leaseMonthlyRows(schedule, { leaseStartMonth: "2026-08-01", termYears: 3 });
    expect(rows).toHaveLength(36);
    expect(rows[0]).toEqual({ seq: 1, month: "2026-08-01", leaseYear: 1, amount: 6216 });
    expect(rows.at(-1)!.month).toBe("2029-07-01");
  });

  it("skips the months before first_payment_month, without shifting the lease year", () => {
    const rows = leaseMonthlyRows(schedule, {
      leaseStartMonth: "2026-08-01",
      termYears: 3,
      firstPaymentMonth: "2026-09-15",
    });
    expect(rows).toHaveLength(35);
    expect(rows[0]).toMatchObject({ seq: 1, month: "2026-09-01", leaseYear: 1 });
    // escalation still happens on the lease anniversary (August), not 12 rows in
    const aug27 = rows.find((r) => r.month === "2027-08-01")!;
    const jul27 = rows.find((r) => r.month === "2027-07-01")!;
    expect(jul27.leaseYear).toBe(1);
    expect(aug27.leaseYear).toBe(2);
    expect(aug27.amount).toBeGreaterThan(jul27.amount);
  });
});

describe("loanScheduleRows", () => {
  const loan: LoanRowLike = {
    id: "l1",
    label: "Δάνειο",
    principal: 12000,
    interest_rate: 0.06,
    term_years: 1,
    grace_years: 0,
    first_amortisation_month: null,
    state: "approved",
    loan_drawdowns: [{ scheduled_month: "2026-11-01", amount: 12000 }],
  };

  it("one row per payment month, due at month end, interest split out", () => {
    const rows = loanScheduleRows(loan);
    expect(rows).toHaveLength(12);
    expect(rows[0].seq).toBe(1);
    expect(rows[0].due_date).toBe("2026-11-30");
    expect(rows[1].due_date).toBe("2026-12-31");
    expect(rows[0].interest).toBe(60);
    const principal = rows.reduce((s, r) => s + (r.amount - (r.interest ?? 0)), 0);
    expect(Math.round(principal)).toBe(12000);
  });

  it("an application or a repaid loan has no scheduled rows", () => {
    expect(loanScheduleRows({ ...loan, state: "in_application" })).toEqual([]);
    expect(loanScheduleRows({ ...loan, state: "repaid" })).toEqual([]);
  });

  it("an actual drawdown replaces the planned one", () => {
    const rows = loanScheduleRows({
      ...loan,
      loan_drawdowns: [{ scheduled_month: "2026-11-01", amount: 12000, actual_date: "2026-12-03", actual_amount: 6000 }],
    });
    expect(rows[0].due_date).toBe("2026-12-31");
    expect(rows[0].interest).toBe(30);
  });
});

describe("leaseScheduleRows", () => {
  const lease: LeaseRowLike = {
    kind: "indexed_rent",
    term_years: 2,
    lease_start_month: "2026-01-01",
    first_payment_month: null,
    lease_indexed_terms: [
      {
        base_monthly_amount: 1000,
        stamp_duty_pct: 0,
        stamp_duty_surcharge_pct: 0,
        escalation_pct: 0.1,
        escalation_first_year: 2,
        stepups_escalate: false,
        stepups_stampable: false,
        lease_step_ups: [],
      },
    ],
  };

  it("rent due on the first of each month, escalating in year 2", () => {
    const rows = leaseScheduleRows(lease, "Ξενοδοχείο");
    expect(rows).toHaveLength(24);
    expect(rows[0]).toMatchObject({ seq: 1, due_date: "2026-01-01", amount: 1000 });
    expect(rows[12]).toMatchObject({ seq: 13, due_date: "2027-01-01", amount: 1100 });
    expect(rows[0].description).toContain("Ξενοδοχείο");
  });

  it("a settlement lease is not scheduled here", () => {
    expect(leaseScheduleRows({ ...lease, kind: "settlement_service" }, "x")).toEqual([]);
  });
});

describe("forecast URL params", () => {
  it("fall back to safe defaults", () => {
    expect(parseScenario("pessimistic")).toBe("pessimistic");
    expect(parseScenario("weird")).toBe("base");
    expect(parseScope("personal")).toBe("personal");
    expect(parseScope(undefined)).toBeNull();
    expect(parseHorizon("24")).toBe(24);
    expect(parseHorizon("99")).toBe(36);
    expect(parseHorizon("-3")).toBe(12);
    expect(parseHorizon(["6", "12"])).toBe(6);
  });
});
