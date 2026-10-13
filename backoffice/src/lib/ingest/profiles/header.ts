import { extractIban, normalizeGreek, parseDate, parseGreekNumber } from "../text";
import { cellText } from "./detect";
import type { Grid } from "./types";

// What a statement says about itself above the table: the account it
// belongs to (IBAN or plain account number) and the period it covers.
// Piraeus e-banking puts «ΒΑΣΙΚΟ ΤΑΜΙΕΥΤΗΡΙΟ Κ: GR.. .... ...» in A4 and
// «Επιλεγμένη Περίοδος: dd/mm/yyyy - dd/mm/yyyy» in A5; Optima's PDF has
// «Αριθμός λογαριασμού: <14 digits>» and «Διαθέσιμο υπόλοιπο: EUR …».

export interface StatementHeader {
  iban: string | null;
  accountNumber: string | null;
  periodStart: string | null; // ISO
  periodEnd: string | null;
  availableBalance: number | null;
}

export const EMPTY_HEADER: StatementHeader = {
  iban: null,
  accountNumber: null,
  periodStart: null,
  periodEnd: null,
  availableBalance: null,
};

const ACCOUNT_NO_RE = /(?:ΑΡΙΘΜΟΣ ΛΟΓΑΡΙΑΣΜΟΥ|ΑΡ\.? ΛΟΓΑΡΙΑΣΜΟΥ|ΛΟΓΑΡΙΑΣΜΟΣ)\s*:?\s*([0-9][0-9 -]{5,30}[0-9])/;
const PERIOD_RE = /ΠΕΡΙΟΔΟΣ\s*:?\s*(\d{1,2}\/\d{1,2}\/\d{2,4})\s*[-–—]\s*(\d{1,2}\/\d{1,2}\/\d{2,4})/;
const AVAILABLE_RE = /ΔΙΑΘΕΣΙΜΟ ΥΠΟΛΟΙΠΟ\s*:?\s*(?:EUR|€)?\s*(-?[0-9][0-9.,]*)/;

// Parse header lines (already-joined cell texts, or PDF text lines).
export function parseHeaderLines(lines: string[]): StatementHeader {
  const out: StatementHeader = { ...EMPTY_HEADER };
  for (const line of lines) {
    const upper = normalizeGreek(line);
    if (!upper) continue;
    out.iban ??= extractIban(upper);
    if (!out.accountNumber) {
      const m = upper.match(ACCOUNT_NO_RE);
      if (m) out.accountNumber = m[1].replace(/\D/g, "");
    }
    if (!out.periodStart) {
      const m = upper.match(PERIOD_RE);
      if (m) {
        out.periodStart = parseDate(m[1], "dd/MM/yyyy");
        out.periodEnd = parseDate(m[2], "dd/MM/yyyy");
      }
    }
    if (out.availableBalance === null) {
      const m = upper.match(AVAILABLE_RE);
      if (m) out.availableBalance = parseGreekNumber(m[1], { decimal: "," });
    }
  }
  return out;
}

// The rows above the table header of a grid.
export function readStatementHeader(grid: Grid, headerRow: number): StatementHeader {
  const lines = grid
    .slice(0, Math.max(0, headerRow))
    .map((row) => (row ?? []).map(cellText).map((c) => c.trim()).filter(Boolean).join(" "));
  return parseHeaderLines(lines);
}

// ---------------------------------------------------------------- accounts

export interface AccountIdentity {
  id: string;
  name: string;
  iban: string | null;
  account_number: string | null;
}

const digits = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "");
const compactIban = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, "").toUpperCase();

// The org account a statement belongs to: same IBAN, else the same account
// number (stored, or the tail of the stored IBAN -- a Greek IBAN ends with
// the account number, zero-padded). Only an unambiguous match counts.
export function matchStatementAccount(
  accounts: AccountIdentity[],
  header: Pick<StatementHeader, "iban" | "accountNumber">,
): AccountIdentity | null {
  const iban = compactIban(header.iban);
  if (iban) {
    const hits = accounts.filter((a) => compactIban(a.iban) === iban);
    if (hits.length === 1) return hits[0];
  }
  const number = (header.accountNumber ? digits(header.accountNumber) : digits(iban).slice(-16)).replace(/^0+/, "");
  if (number.length < 6) return null;
  const hits = accounts.filter((a) => {
    const own = digits(a.account_number).replace(/^0+/, "");
    if (own && (own === number || own.endsWith(number) || number.endsWith(own))) return own.length >= 6;
    const ibanDigits = digits(compactIban(a.iban).slice(4));
    return ibanDigits.length > 0 && ibanDigits.endsWith(number);
  });
  return hits.length === 1 ? hits[0] : null;
}
