import { describe, expect, it } from "vitest";
import {
  formatBytes,
  formatDate,
  formatDuration,
  formatMoney,
  formatMultiple,
  formatNumber,
  formatPercent,
  formatPercentPoints,
  formatSignedMoney,
  moneyOrDash,
} from "./format";

const nb = (s: string) => s.replace(/ /g, " ");

describe("money", () => {
  it("uses the true minus, no space after it", () => {
    expect(nb(formatMoney(-61.53))).toBe("−61,53 €");
    expect(nb(formatMoney(-6.2))).toBe("−6,20 €");
    expect(formatMoney(-6.2)).not.toContain("-");
  });
  it("never prints −0,00", () => {
    expect(nb(formatMoney(-0.001))).toBe("0,00 €");
    expect(nb(formatMoney(null))).toBe("0,00 €");
  });
  it("dash for zero in tables", () => {
    expect(moneyOrDash(0)).toBe("—");
    expect(moneyOrDash(null)).toBe("—");
    expect(nb(moneyOrDash(12))).toBe("12,00 €");
  });
  it("signed", () => {
    expect(nb(formatSignedMoney(1200))).toBe("+1.200,00 €");
    expect(nb(formatSignedMoney(-3))).toBe("−3,00 €");
    expect(nb(formatSignedMoney(0))).toBe("0,00 €");
  });
});

describe("percent and numbers", () => {
  it("comma decimals", () => {
    expect(formatPercent(0.171)).toBe("17,1%");
    expect(formatPercent(0.5)).toBe("50%");
    expect(formatPercent(0.083, { signed: true })).toBe("+8,3%");
    expect(formatPercent(-0.083)).toBe("−8,3%");
    expect(formatPercent(0.1, { fixed: true })).toBe("10,0%");
    expect(formatPercentPoints(12.5)).toBe("12,5%");
  });
  it("an absurd percentage is a dash", () => {
    expect(formatPercent(171.262)).toBe("—");
    expect(formatPercent(Number.NaN)).toBe("—");
  });
  it("numbers and multiples", () => {
    expect(formatNumber(1234.5, 1)).toBe("1.234,5");
    expect(formatMultiple(1.254)).toBe("1,25×");
    expect(formatMultiple(null)).toBe("—");
  });
});

describe("durations, sizes, dates", () => {
  it("durations", () => {
    expect(formatDuration(8300)).toBe("8,3 δευτ.");
    expect(formatDuration(420)).toBe("420 ms");
    expect(formatDuration(125_000)).toBe("2 λεπ. 5 δευτ.");
  });
  it("sizes", () => {
    expect(formatBytes(1.2 * 1024 * 1024)).toBe("1,2 MB");
  });
  it("calendar dates are not shifted by the time zone", () => {
    expect(formatDate("2026-10-09")).toBe("09/10/2026");
    expect(formatDate(null)).toBe("");
  });
});
