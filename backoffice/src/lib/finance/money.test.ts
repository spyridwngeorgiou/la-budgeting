import { describe, it, expect } from "vitest";
import { toCents, fromCents, deriveFromNet, deriveFromGross, cashOnly, isIdentityConsistent, isValidAfm } from "./money";

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
