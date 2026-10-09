import { normalizeGreek } from "../text";
import type { BankProfile, Cell, ColumnMap, Grid, ProfileField } from "./types";
import { toIso } from "@/lib/dates";

// Which profile fits an uploaded statement, and on which row its header sits.
// Exports typically open with a few lines of account details (holder, IBAN,
// period) before the table, so the header row is searched for in the first
// rows rather than assumed to be row 1.

const HEADER_SCAN_ROWS = 40;

export function cellText(cell: Cell): string {
  if (cell === null || cell === undefined) return "";
  if (cell instanceof Date) return toIso(cell);
  return String(cell);
}

export function normalizedRow(row: Cell[] | undefined): string[] {
  return (row ?? []).map((c) => normalizeGreek(cellText(c)));
}

export interface DetectedLayout {
  profile: BankProfile;
  headerRow: number; // 0-based index into the grid
  score: number;
}

// The first row containing every header-signature cell.
export function findHeaderRow(grid: Grid, signature: string[]): number | null {
  if (signature.length === 0) return null;
  const wanted = signature.map(normalizeGreek);
  for (let r = 0; r < Math.min(grid.length, HEADER_SCAN_ROWS); r++) {
    const cells = new Set(normalizedRow(grid[r]));
    if (wanted.every((w) => cells.has(w))) return r;
  }
  return null;
}

// Best matching profile: every signature cell present; a longer signature
// beats a shorter one (a bank's own layout over "generic"), then the org's
// own saved profile over a preset, then verified over unverified.
export function detectProfile(grid: Grid, profiles: BankProfile[]): DetectedLayout | null {
  let best: DetectedLayout | null = null;
  for (const profile of profiles) {
    const headerRow = findHeaderRow(grid, profile.headerSignature);
    if (headerRow === null) continue;
    const score =
      profile.headerSignature.length * 10 + (profile.orgId ? 5 : 0) + (profile.verified ? 3 : 0);
    if (!best || score > best.score) best = { profile, headerRow, score };
  }
  return best;
}

// Header vocabulary for an unknown layout: what the mapping wizard proposes
// before a human confirms. Normalised forms; first match wins per field.
const VOCABULARY: Record<ProfileField, string[]> = {
  date: ["ΗΜΕΡΟΜΗΝΙΑ", "ΗΜ/ΝΙΑ", "ΗΜΕΡΟΜΗΝΙΑ ΣΥΝΑΛΛΑΓΗΣ", "ΗΜ/ΝΙΑ ΣΥΝΑΛΛΑΓΗΣ", "ΗΜΕΡΟΜΗΝΙΑ ΚΙΝΗΣΗΣ", "DATE", "BOOKING DATE"],
  value_date: ["ΗΜΕΡΟΜΗΝΙΑ ΑΞΙΑΣ", "ΗΜ/ΝΙΑ ΑΞΙΑΣ", "ΑΞΙΑ", "VALUE DATE"],
  description: ["ΠΕΡΙΓΡΑΦΗ", "ΑΙΤΙΟΛΟΓΙΑ", "ΠΕΡΙΓΡΑΦΗ ΚΙΝΗΣΗΣ", "ΣΤΟΙΧΕΙΑ ΣΥΝΑΛΛΑΓΗΣ", "DESCRIPTION", "DETAILS"],
  amount: ["ΠΟΣΟ", "ΠΟΣΟ ΣΥΝΑΛΛΑΓΗΣ", "ΠΟΣΟ ΚΙΝΗΣΗΣ", "AMOUNT"],
  debit: ["ΧΡΕΩΣΗ", "ΧΡΕΩΣΕΙΣ", "ΑΝΑΛΗΨΗ", "DEBIT"],
  credit: ["ΠΙΣΤΩΣΗ", "ΠΙΣΤΩΣΕΙΣ", "ΚΑΤΑΘΕΣΗ", "CREDIT"],
  direction: ["ΠΡΟΣΗΜΟ", "ΠΡΟΣΗΜΟ ΠΟΣΟΥ", "Χ/Π", "ΤΥΠΟΣ ΚΙΝΗΣΗΣ", "D/C"],
  balance: ["ΥΠΟΛΟΙΠΟ", "ΛΟΓΙΣΤΙΚΟ ΥΠΟΛΟΙΠΟ", "ΔΙΑΘΕΣΙΜΟ ΥΠΟΛΟΙΠΟ", "BALANCE"],
  reference: ["ΑΡ. ΣΥΝΑΛΛΑΓΗΣ", "ΑΡΙΘΜΟΣ ΣΥΝΑΛΛΑΓΗΣ", "ΚΩΔ. ΣΥΝΑΛΛΑΓΗΣ", "ΑΝΑΦΟΡΑ", "ΑΡΙΘΜΟΣ ΑΝΑΦΟΡΑΣ", "REFERENCE"],
  counterparty: ["ΑΝΤΙΣΥΜΒΑΛΛΟΜΕΝΟΣ", "ΟΝΟΜΑ ΑΝΤΙΣΥΜΒΑΛΛΟΜΕΝΟΥ", "ΔΙΚΑΙΟΥΧΟΣ", "ΕΝΤΟΛΕΑΣ", "COUNTERPARTY"],
  counterparty_iban: ["IBAN ΑΝΤΙΣΥΜΒΑΛΛΟΜΕΝΟΥ", "IBAN ΔΙΚΑΙΟΥΧΟΥ", "IBAN"],
};

// The row (within the first rows) that looks most like a table header:
// most cells that are known header words. Needs at least a date and an
// amount-ish column to count.
export function guessHeaderRow(grid: Grid): number | null {
  let bestRow: number | null = null;
  let bestHits = 1;
  for (let r = 0; r < Math.min(grid.length, HEADER_SCAN_ROWS); r++) {
    const cells = normalizedRow(grid[r]);
    const hits = cells.filter((c) => Object.values(VOCABULARY).some((words) => words.includes(c))).length;
    const hasDate = cells.some((c) => VOCABULARY.date.includes(c));
    const hasMoney = cells.some((c) => [...VOCABULARY.amount, ...VOCABULARY.debit, ...VOCABULARY.credit].includes(c));
    if (hasDate && hasMoney && hits > bestHits) {
      bestHits = hits;
      bestRow = r;
    }
  }
  return bestRow;
}

// Proposed column map for a header row, as 0-based indexes (the wizard
// shows them as dropdowns). Each column is used at most once.
export function guessColumnMap(headerCells: Cell[]): ColumnMap {
  const cells = normalizedRow(headerCells);
  const used = new Set<number>();
  const map: ColumnMap = {};
  for (const field of Object.keys(VOCABULARY) as ProfileField[]) {
    for (const word of VOCABULARY[field]) {
      const idx = cells.findIndex((c, i) => !used.has(i) && c === word);
      if (idx >= 0) {
        map[field] = idx;
        used.add(idx);
        break;
      }
    }
  }
  return map;
}
