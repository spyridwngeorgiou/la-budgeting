import { describe, it, expect } from "vitest";
import { parseCsv, sniffDelimiter } from "./csv";
import { decodeBytes, decodeWindows1253, encodeWindows1253 } from "./decode";
import { bankLineBaseKey, bankLineKeys, fnv1a64 } from "./fingerprint";

describe("parseCsv (RFC 4180)", () => {
  it("handles quotes, escaped quotes, embedded delimiters and newlines", () => {
    const text = 'a;b;c\r\n1;"x;y";"say ""hi"""\r\n2;"line1\nline2";\r\n';
    expect(parseCsv(text, { delimiter: ";" })).toEqual([
      ["a", "b", "c"],
      ["1", "x;y", 'say "hi"'],
      ["2", "line1\nline2", ""],
    ]);
  });

  it("strips a UTF-8 BOM and accepts LF / CR / CRLF", () => {
    expect(parseCsv("﻿a,b\nc,d\re,f", { delimiter: "," })).toEqual([
      ["a", "b"],
      ["c", "d"],
      ["e", "f"],
    ]);
  });

  it("keeps blank lines so row numbers match the file", () => {
    expect(parseCsv("a\n\nb\n", { delimiter: "," })).toEqual([["a"], [""], ["b"]]);
  });

  it("sniffs ';' for Greek decimal-comma exports and ',' otherwise", () => {
    expect(sniffDelimiter("Ημερομηνία;Ποσό\n01/03/2026;1.234,56\n02/03/2026;12,00")).toBe(";");
    expect(sniffDelimiter('Date,Amount\n2026-03-01,"1,234.56"\n2026-03-02,12.00')).toBe(",");
    expect(sniffDelimiter("a\tb\tc\n1\t2\t3")).toBe("\t");
  });
});

describe("decode", () => {
  it("built-in windows-1253 table agrees with the runtime's decoder on every byte", () => {
    const all = new Uint8Array(256).map((_, i) => i);
    const native = new TextDecoder("windows-1253").decode(all);
    expect(decodeWindows1253(all)).toBe(native);
  });

  it("round-trips Greek text through the 1253 encoder", () => {
    const s = "Ημερομηνία;Περιγραφή;Ποσό € «ΔΕΗ» ΐΰ";
    expect(decodeWindows1253(encodeWindows1253(s))).toBe(s);
  });

  it("detects UTF-8 (with or without BOM) and falls back to windows-1253", () => {
    const greek = "Κατάθεση";
    expect(decodeBytes(new TextEncoder().encode(greek))).toEqual({ text: greek, encoding: "utf-8" });
    const bom = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode(greek)]);
    expect(decodeBytes(bom, "windows-1253")).toEqual({ text: greek, encoding: "utf-8" });
    expect(decodeBytes(encodeWindows1253(greek))).toEqual({ text: greek, encoding: "windows-1253" });
  });
});

describe("bank line fingerprint", () => {
  const line = {
    accountId: "acc-1",
    date: "2026-03-05",
    signedAmount: -2,
    description: "ΠΡΟΜΗΘΕΙΑ ΕΜΒΑΣΜΑΤΟΣ",
    reference: null,
    balanceAfter: null,
  };

  it("is stable across cosmetic description differences", () => {
    expect(bankLineBaseKey(line)).toBe(bankLineBaseKey({ ...line, description: "  Προμήθεια   εμβάσματος " }));
    expect(bankLineBaseKey(line)).toMatch(/^bank:acc-1:2026-03-05:-200:[0-9a-f]{16}$/);
  });

  it("differs on account, sign, amount, date and balance", () => {
    const base = bankLineBaseKey(line);
    expect(bankLineBaseKey({ ...line, accountId: "acc-2" })).not.toBe(base);
    expect(bankLineBaseKey({ ...line, signedAmount: 2 })).not.toBe(base);
    expect(bankLineBaseKey({ ...line, signedAmount: -2.01 })).not.toBe(base);
    expect(bankLineBaseKey({ ...line, date: "2026-03-06" })).not.toBe(base);
    expect(bankLineBaseKey({ ...line, balanceAfter: 11171.55 })).not.toBe(base);
  });

  it("numbers identical lines within one file, the same way in an overlapping file", () => {
    const keys = bankLineKeys([line, line, { ...line, signedAmount: -3 }, line]);
    expect(keys[1]).toBe(`${keys[0]}#2`);
    expect(keys[3]).toBe(`${keys[0]}#3`);
    expect(new Set(keys).size).toBe(4);
    expect(bankLineKeys([line, line])).toEqual(keys.slice(0, 2));
  });

  it("fnv1a64 matches the reference vectors", () => {
    expect(fnv1a64("")).toBe("cbf29ce484222325");
    expect(fnv1a64("a")).toBe("af63dc4c8601ec8c");
  });
});
