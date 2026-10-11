import { describe, expect, it } from "vitest";
import { inboxTotal } from "./inboxCount";

describe("inboxTotal", () => {
  it("adds review rows, AI changes and canvas proposals", () => {
    expect(inboxTotal({ rows: 4, changes: 2, proposals: 1 })).toBe(7);
  });

  it("treats missing or failed counts as zero", () => {
    expect(inboxTotal(null)).toBe(0);
    expect(inboxTotal({ rows: 3 })).toBe(3);
    expect(inboxTotal({ rows: Number.NaN, changes: -1, proposals: 2 })).toBe(2);
  });
});
