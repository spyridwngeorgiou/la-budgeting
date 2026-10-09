import { describe, expect, it, vi } from "vitest";
import { redirect } from "next/navigation";
import { action, errorOf, fail, isFailure, ok, pgErrorToGreek, UserError } from "./actions";

describe("pgErrorToGreek", () => {
  it.each([
    ["23505", "Υπάρχει ήδη"],
    ["23503", "συνδέεται"],
    ["23514", "ελέγχου εγκυρότητας"],
    ["42501", "δικαίωμα"],
  ])("maps %s to Greek", (code, fragment) => {
    expect(pgErrorToGreek({ code, message: "duplicate key value violates unique constraint" })).toContain(fragment);
  });
  it("passes our own trigger messages (P0001) through", () => {
    expect(pgErrorToGreek({ code: "P0001", message: "Η περίοδος είναι κλειδωμένη." })).toBe("Η περίοδος είναι κλειδωμένη.");
  });
  it("never leaks an unknown English message", () => {
    expect(pgErrorToGreek({ code: "XX000", message: "internal error" })).not.toContain("internal");
    expect(pgErrorToGreek(new Error("boom"))).not.toContain("boom");
  });
});

describe("action()", () => {
  it("wraps success", async () => {
    expect(await action(async () => {})).toEqual({ ok: true });
    expect(await action(async () => 42)).toEqual({ ok: true, data: 42 });
  });
  it("passes through an explicit result", async () => {
    expect(await action(async () => fail("όχι"))).toEqual({ error: "όχι" });
  });
  it("returns a UserError's message", async () => {
    const r = await action(async () => {
      throw new UserError("Μη έγκυρο ΑΦΜ.");
    });
    expect(r).toEqual({ error: "Μη έγκυρο ΑΦΜ." });
  });
  it("maps a Postgres error", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await action(async () => {
      throw { code: "23505", message: "dup" };
    });
    expect(isFailure(r) && r.error).toContain("Υπάρχει ήδη");
  });
  it("rethrows redirect()", async () => {
    await expect(action(async () => redirect("/dashboard"))).rejects.toThrow();
  });
  it("errorOf reads only real failures", () => {
    expect(errorOf(fail("x"))).toBe("x");
    expect(errorOf(ok())).toBeNull();
    expect(errorOf(undefined)).toBeNull();
  });
});
