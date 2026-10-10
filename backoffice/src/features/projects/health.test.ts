import { describe, expect, it } from "vitest";
import { projectHealth } from "./health";

const ok = { hasBudget: true, remaining: 1000, urgentNotes: 0, watchNotes: 0, overduePayments: 0 };

describe("projectHealth", () => {
  it("a budgeted project with nothing open is fine", () => {
    expect(projectHealth(ok)).toBe("positive");
  });

  it("over budget, an urgent note or an overdue payment is a problem", () => {
    expect(projectHealth({ ...ok, remaining: -1 })).toBe("negative");
    expect(projectHealth({ ...ok, urgentNotes: 1 })).toBe("negative");
    expect(projectHealth({ ...ok, overduePayments: 2 })).toBe("negative");
  });

  it("no budget or a note to watch needs attention", () => {
    expect(projectHealth({ ...ok, hasBudget: false, remaining: 0 })).toBe("warning");
    expect(projectHealth({ ...ok, watchNotes: 1 })).toBe("warning");
  });

  it("without a budget a negative remainder is not «over budget»", () => {
    expect(projectHealth({ ...ok, hasBudget: false, remaining: -500 })).toBe("warning");
  });
});
