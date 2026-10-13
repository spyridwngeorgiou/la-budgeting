import { describe, expect, it } from "vitest";
import { amountInputValue, parseAmountInput } from "./amountInput";

describe("parseAmountInput", () => {
  it("reads amounts the way they are typed in Greek", () => {
    expect(parseAmountInput("12,50")).toBe(12.5);
    expect(parseAmountInput("1.234,56")).toBe(1234.56);
    expect(parseAmountInput("1.234")).toBe(1234);
    expect(parseAmountInput(" 80 ")).toBe(80);
    expect(parseAmountInput("-80,10")).toBe(-80.1);
  });

  it("still reads a decimal point", () => {
    expect(parseAmountInput("12.5")).toBe(12.5);
    expect(parseAmountInput("1234.56")).toBe(1234.56);
  });

  it("refuses blanks, garbage and fractions of a cent", () => {
    expect(parseAmountInput("")).toBeNull();
    expect(parseAmountInput(null)).toBeNull();
    expect(parseAmountInput("abc")).toBeNull();
    expect(parseAmountInput("12,345")).toBeNull();
  });
});

describe("amountInputValue", () => {
  it("writes a stored amount back with a decimal comma", () => {
    expect(amountInputValue(1234.5)).toBe("1234,5");
    expect(amountInputValue(0)).toBe("0");
    expect(amountInputValue(null)).toBe("");
    expect(parseAmountInput(amountInputValue(1234.56))).toBe(1234.56);
  });
});
