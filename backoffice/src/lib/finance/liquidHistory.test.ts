import { describe, expect, it } from "vitest";
import { liquidMonthEnds } from "./liquidHistory";

describe("liquidMonthEnds", () => {
  it("rebuilds month-end balances backwards from today", () => {
    const res = liquidMonthEnds(
      ["2026-08", "2026-09", "2026-10"],
      [
        { account_id: "a", current_balance: 1000, opening_balance_date: "2020-01-01" },
        { account_id: "b", current_balance: 50, opening_balance_date: "2026-09-15" },
      ],
      [
        { account_id: "a", month: "2026-09", inflow: 300, outflow: 100 },
        { account_id: "a", month: "2026-10", inflow: 0, outflow: 400 },
        { account_id: "b", month: "2026-10", inflow: 10, outflow: 0 },
        { account_id: "x", month: "2026-10", inflow: 999, outflow: 0 }, // not liquid
      ],
    );
    expect(res).toEqual([
      { month: "2026-08", balance: 1200 }, // b did not exist yet
      { month: "2026-09", balance: 1440 },
      { month: "2026-10", balance: 1050 },
    ]);
  });
});
