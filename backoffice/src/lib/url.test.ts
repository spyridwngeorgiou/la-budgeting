import { describe, expect, it } from "vitest";
import { withParams } from "./url";

describe("withParams", () => {
  it("keeps the other filters when changing one", () => {
    expect(withParams("/transactions", { project_id: "p1", status: "paid" }, { status: "pending" })).toBe(
      "/transactions?project_id=p1&status=pending",
    );
  });
  it("adds a new key at the end", () => {
    expect(withParams("/t", { a: "1" }, { b: "2" })).toBe("/t?a=1&b=2");
  });
  it("removes keys set to null, undefined or empty", () => {
    expect(withParams("/t", { a: "1", b: "2", c: "3" }, { a: null, b: undefined, c: "" })).toBe("/t");
  });
  it("drops empty current values", () => {
    expect(withParams("/t", { a: "", b: undefined, c: "x" })).toBe("/t?c=x");
  });
  it("repeats array values and accepts URLSearchParams", () => {
    expect(withParams("/t", { tag: ["a", "b"] })).toBe("/t?tag=a&tag=b");
    expect(withParams("/t", new URLSearchParams("x=1&tag=a&tag=b"), { x: "2" })).toBe("/t?x=2&tag=a&tag=b");
  });
  it("encodes values", () => {
    expect(withParams("/assistant", {}, { q: "ΦΠΑ & έσοδα" })).toBe("/assistant?q=%CE%A6%CE%A0%CE%91+%26+%CE%AD%CF%83%CE%BF%CE%B4%CE%B1");
  });
});
