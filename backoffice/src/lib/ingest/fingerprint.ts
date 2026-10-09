import { toCents } from "@/lib/finance/money";
import { normalizeGreek } from "./text";

// external_key for a bank line: the identity that lets the database refuse
// the same movement from two overlapping statements (unique among committed
// ingest_rows, 0054). Built from what a bank never changes between exports
// of the same line -- account, booking date, signed amount, description,
// reference, running balance -- and NOT from the row number or file name.
//
// Two genuinely identical lines in one file (two €2,00 fees on the same day,
// no balance column to tell them apart) get #2, #3... in file order, so both
// survive. The same pair in an overlapping export gets the same suffixes.

// FNV-1a 64-bit over UTF-16 code units; sync and dependency-free (the Web
// Crypto digest is async, and this is not a security boundary).
export function fnv1a64(input: string): string {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  for (let i = 0; i < input.length; i++) {
    hash ^= BigInt(input.charCodeAt(i));
    hash = (hash * prime) & mask;
  }
  return hash.toString(16).padStart(16, "0");
}

export interface BankLineIdentity {
  accountId: string;
  date: string; // booking date, ISO
  signedAmount: number; // negative = money out
  description?: string | null;
  reference?: string | null;
  balanceAfter?: number | null;
}

export function bankLineBaseKey(line: BankLineIdentity): string {
  const detail = [
    normalizeGreek(line.description).replace(/\s+/g, " "),
    normalizeGreek(line.reference),
    line.balanceAfter == null ? "" : String(toCents(line.balanceAfter)),
  ].join("|");
  return `bank:${line.accountId}:${line.date}:${toCents(line.signedAmount)}:${fnv1a64(detail)}`;
}

// Keys for every line of one file, in file order, with #n on repeats.
export function bankLineKeys(lines: BankLineIdentity[]): string[] {
  const seen = new Map<string, number>();
  return lines.map((line) => {
    const base = bankLineBaseKey(line);
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return n === 1 ? base : `${base}#${n}`;
  });
}
