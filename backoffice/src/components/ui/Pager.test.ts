import { describe, expect, it } from "vitest";
import { pageHref } from "./Pager";

describe("pageHref", () => {
  it("keeps every filter, drops page/new, and leaves page 1 out of the URL", () => {
    const params = { q: "δόση", status: ["pending", "scheduled"], page: "3", new: "1", empty: "" };
    expect(pageHref("/transactions", params, 2)).toBe("/transactions?q=%CE%B4%CF%8C%CF%83%CE%B7&status=pending&status=scheduled&page=2");
    expect(pageHref("/transactions", params, 1)).toBe("/transactions?q=%CE%B4%CF%8C%CF%83%CE%B7&status=pending&status=scheduled");
    expect(pageHref("/accounts/x", {}, 1)).toBe("/accounts/x");
  });
});
