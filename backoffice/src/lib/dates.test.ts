import { describe, expect, it } from "vitest";
import {
  addMonths,
  athensMinuteLabel,
  currentMonthKey,
  currentYear,
  monthRange,
  monthsBetween,
  quarterOf,
  shortMonthYearLabel,
  todayAthens,
  toIso,
} from "./dates";

describe("Athens 'now' around midnight", () => {
  it("is already the next day at 00:30 Athens (21:30 UTC in summer)", () => {
    const now = new Date("2026-07-31T21:30:00Z");
    expect(todayAthens(now)).toBe("2026-08-01");
    expect(currentMonthKey(now)).toBe("2026-08");
  });
  it("is already the next month at 01:00 Athens in winter (23:00 UTC)", () => {
    const now = new Date("2026-01-31T23:00:00Z");
    expect(currentMonthKey(now)).toBe("2026-02");
  });
  it("rolls the year at Athens midnight", () => {
    expect(currentYear(new Date("2026-12-31T22:00:00Z"))).toBe(2027);
    expect(currentYear(new Date("2026-12-31T21:59:00Z"))).toBe(2026);
  });
});

describe("DST transitions (Europe/Athens)", () => {
  // Spring forward: 2026-03-29 03:00 local -> 04:00 (01:00 UTC).
  it("spring forward keeps the calendar day", () => {
    expect(todayAthens(new Date("2026-03-28T21:59:00Z"))).toBe("2026-03-28"); // 23:59 EET
    expect(todayAthens(new Date("2026-03-28T22:00:00Z"))).toBe("2026-03-29"); // 00:00 EET
    expect(athensMinuteLabel(new Date("2026-03-29T00:59:00Z"))).toBe("2026-03-29 02:59");
    expect(athensMinuteLabel(new Date("2026-03-29T01:00:00Z"))).toBe("2026-03-29 04:00");
  });
  // Fall back: 2026-10-25 04:00 local -> 03:00 (01:00 UTC).
  it("fall back keeps the calendar day", () => {
    expect(todayAthens(new Date("2026-10-24T20:59:00Z"))).toBe("2026-10-24"); // 23:59 EEST
    expect(todayAthens(new Date("2026-10-24T21:00:00Z"))).toBe("2026-10-25"); // 00:00 EEST
    expect(todayAthens(new Date("2026-10-25T21:59:00Z"))).toBe("2026-10-25"); // 23:59 EET
    expect(todayAthens(new Date("2026-10-25T22:00:00Z"))).toBe("2026-10-26");
  });
});

describe("month helpers", () => {
  it("monthRange gives first and last day, leap-aware", () => {
    expect(monthRange("2028-02")).toEqual({ start: "2028-02-01", end: "2028-02-29" });
    expect(monthRange("2026-12")).toEqual({ start: "2026-12-01", end: "2026-12-31" });
  });
  it("monthsBetween is inclusive and crosses years", () => {
    expect(monthsBetween("2026-11", "2027-02")).toEqual(["2026-11", "2026-12", "2027-01", "2027-02"]);
    expect(monthsBetween("2026-05", "2026-05")).toEqual(["2026-05"]);
    expect(monthsBetween("2026-06", "2026-05")).toEqual([]);
  });
  it("addMonths crosses year boundaries both ways", () => {
    expect(addMonths("2026-01", -1)).toBe("2025-12");
    expect(addMonths("2026-12", 13)).toBe("2028-01");
  });
  it("quarterOf accepts month keys and dates", () => {
    expect(quarterOf("2026-01")).toBe(1);
    expect(quarterOf("2026-03-31")).toBe(1);
    expect(quarterOf("2026-04")).toBe(2);
    expect(quarterOf("2026-12-01")).toBe(4);
  });
  it("toIso reads a UTC-midnight Date as its calendar day", () => {
    expect(toIso(new Date(Date.UTC(2026, 9, 9)))).toBe("2026-10-09");
  });
  it("shortMonthYearLabel is the compact el-GR column label", () => {
    expect(shortMonthYearLabel("2026-10")).toMatch(/26$/);
  });
});
