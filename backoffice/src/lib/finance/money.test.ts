import { describe, it, expect } from "vitest";
import { toCents, fromCents, deriveFromNet, deriveFromGross, cashOnly, isIdentityConsistent, isValidAfm, splitProportionally } from "./money";

describe("toCents / fromCents", () => {
  it("round-trips without floating-point drift", () => {
    expect(toCents(19.99)).toBe(1999);
    expect(fromCents(1999)).toBe(19.99);
    expect(toCents(0.1 + 0.2)).toBe(30); // the classic float trap, must land on 30 not 29/31
  });
});

describe("deriveFromNet", () => {
  it("computes VAT and gross at the standard 24% rate", () => {
    const b = deriveFromNet(100, 0.24);
    expect(b.net).toBe(100);
    expect(b.vat).toBe(24);
    expect(b.gross).toBe(124);
    expect(b.withholding).toBe(0);
  });

  it("subtracts withholding from gross, not from net or vat", () => {
    const b = deriveFromNet(100, 0.24, 5);
    expect(b.net).toBe(100);
    expect(b.vat).toBe(24);
    expect(b.withholding).toBe(5);
    expect(b.gross).toBe(119); // 100 + 24 - 5
  });

  it("satisfies the identity check it's meant to feed", () => {
    const b = deriveFromNet(133.33, 0.24, 7.5);
    expect(isIdentityConsistent(b)).toBe(true);
  });
});

describe("deriveFromGross", () => {
  it("is the inverse of deriveFromNet at whole-cent amounts", () => {
    const forward = deriveFromNet(100, 0.24);
    const back = deriveFromGross(forward.gross, 0.24);
    expect(back.net).toBe(forward.net);
    expect(back.vat).toBe(forward.vat);
    expect(back.gross).toBe(forward.gross);
  });

  it("backs out net/VAT from a stated gross (the NL-entry case)", () => {
    // "πλήρωσα 250" at 24% VAT: net = 250 / 1.24
    const b = deriveFromGross(250, 0.24);
    expect(b.gross).toBe(250);
    expect(isIdentityConsistent(b)).toBe(true);
  });

  it("stays identity-consistent with withholding applied", () => {
    const b = deriveFromGross(500, 0.24, 20);
    expect(isIdentityConsistent(b)).toBe(true);
  });
});

describe("cashOnly", () => {
  it("carries no VAT or withholding, gross equals net", () => {
    const b = cashOnly(80);
    expect(b).toEqual({ net: 80, vat: 0, vatRate: 0, withholding: 0, gross: 80 });
    expect(isIdentityConsistent(b)).toBe(true);
  });
});

describe("isIdentityConsistent", () => {
  it("rejects a breakdown where net + vat - withholding != gross", () => {
    expect(isIdentityConsistent({ net: 100, vat: 24, vatRate: 0.24, withholding: 0, gross: 200 })).toBe(false);
  });

  it("tolerates sub-cent rounding noise within the 0.02 tolerance", () => {
    expect(isIdentityConsistent({ net: 100, vat: 24, vatRate: 0.24, withholding: 0, gross: 124.01 })).toBe(true);
  });
});

describe("isValidAfm", () => {
  it("rejects non-9-digit strings outright", () => {
    expect(isValidAfm("12345")).toBe(false);
    expect(isValidAfm("ABCDEFGHI")).toBe(false);
  });

  it("rejects a 9-digit string with a wrong check digit", () => {
    // 090000045 is a valid AFM (see below); changing only its check digit
    // must fail the mod-11 test.
    expect(isValidAfm("090000041")).toBe(false);
  });

  it("accepts a known-valid AFM (mod-11 checksum holds)", () => {
    // 090000045: verified against the algorithm in isValidAfm itself --
    // sum(d[i] * 2^(8-i)) % 11 % 10 == d[8].
    expect(isValidAfm("090000045")).toBe(true);
  });
});

describe("splitProportionally", () => {
  const exact = (b: { net: number; vat: number; withholding: number; gross: number }) =>
    toCents(b.net) + toCents(b.vat) - toCents(b.withholding) === toCents(b.gross);

  it("splits a cash commitment (no VAT) -- the workbook's προσύμφωνο case", () => {
    const { paid, remaining } = splitProportionally(cashOnly(19000), 2000);
    expect(paid).toMatchObject({ net: 2000, vat: 0, withholding: 0, gross: 2000 });
    expect(remaining).toMatchObject({ net: 17000, vat: 0, withholding: 0, gross: 17000 });
  });

  it("keeps the identity exact on both halves at 24% VAT with 20% withholding", () => {
    const parent = deriveFromNet(10000, 0.24, 2000); // gross 10400
    const { paid, remaining } = splitProportionally(parent, 3333.33);
    expect(paid.gross).toBe(3333.33);
    expect(exact(paid)).toBe(true);
    expect(exact(remaining)).toBe(true);
    expect(toCents(paid.gross) + toCents(remaining.gross)).toBe(toCents(parent.gross));
    expect(toCents(paid.vat) + toCents(remaining.vat)).toBe(toCents(parent.vat));
    expect(toCents(paid.withholding) + toCents(remaining.withholding)).toBe(toCents(parent.withholding));
  });

  it("handles one-cent edges", () => {
    const parent = deriveFromNet(100, 0.24); // gross 124
    for (const amount of [0.01, 123.99, 61.99]) {
      const { paid, remaining } = splitProportionally(parent, amount);
      expect(exact(paid) && exact(remaining)).toBe(true);
      expect(remaining.vat).toBeGreaterThanOrEqual(0);
    }
  });

  it("rejects zero, negative, and full-or-more amounts", () => {
    for (const amount of [0, -5, 124, 200]) {
      expect(() => splitProportionally(deriveFromNet(100, 0.24), amount)).toThrow();
    }
  });
});
