import { describe, expect, it } from "vitest";
import { scenarioBalanceRows } from "./cashCharts";

const label = (m: string) => `L${m}`;

describe("scenarioBalanceRows", () => {
  it("puts each scenario's closing balance on the months of the first", () => {
    const rows = scenarioBalanceRows(
      {
        base: [
          { month: "2026-10-01", closing_balance: "100.004" },
          { month: "2026-11-01", closing_balance: -5 },
        ],
        pessimistic: [{ month: "2026-10-01", closing_balance: 80 }],
      },
      label,
    );
    expect(rows).toEqual([
      { label: "L2026-10", base: 100, pessimistic: 80 },
      { label: "L2026-11", base: -5, pessimistic: null },
    ]);
  });
});
