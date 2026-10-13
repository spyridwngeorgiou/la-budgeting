import { toCents } from "@/lib/finance/money";
import { bankLineKeys } from "../fingerprint";
import { extractRefs, normalizeGreek, parseDate, parseGreekNumber } from "../text";
import type { CanonicalRow, StatementSummary } from "../types";
import { cellText, normalizedRow } from "./detect";
import { isJoinedRef, type BankProfile, type Cell, type ColumnMapValue, type ColumnRef, type Grid, type ProfileField } from "./types";
import { toIso } from "@/lib/dates";

// Grid + profile -> canonical movements. Never throws on a bad line: the
// line is kept with parseErrors so the review screen shows it, instead of a
// statement silently coming in one movement short.

export class ProfileMismatchError extends Error {}

export type ResolvedColumns = Partial<Record<ProfileField, number>>;
// Every column of a field, in map order (more than one for a joined field).
export type ResolvedColumnSets = Partial<Record<ProfileField, number[]>>;

// Map each profile field to column indexes: exact (normalised) header
// matches first for every field, then "header contains the word" for what
// is left, never reusing a column -- so «ΗΜΕΡΟΜΗΝΙΑ» does not swallow
// «ΗΜΕΡΟΜΗΝΙΑ ΑΞΙΑΣ» when both exist. A header that repeats («Νόμισμα»
// twice) is told apart by position: each match takes the first unused one.
export function resolveColumnSets(headerCells: Cell[], profile: Pick<BankProfile, "columnMap">): ResolvedColumnSets {
  const header = normalizedRow(headerCells);
  const used = new Set<number>();
  const slots = (Object.entries(profile.columnMap) as [ProfileField, ColumnMapValue][]).flatMap(([field, value]) =>
    (isJoinedRef(value) ? value.join : [value]).map((ref) => ({ field, ref, idx: -1 })),
  );
  const alternatives = (ref: ColumnRef) => (Array.isArray(ref) ? ref : [ref]).map((a) => (typeof a === "number" ? a : normalizeGreek(String(a))));

  for (const slot of slots) {
    for (const alt of alternatives(slot.ref)) {
      const idx = typeof alt === "number" ? (alt < header.length || header.length === 0 ? alt : -1) : header.findIndex((h, i) => !used.has(i) && h === alt);
      if (idx >= 0 && !used.has(idx)) {
        slot.idx = idx;
        used.add(idx);
        break;
      }
    }
  }
  for (const slot of slots) {
    if (slot.idx >= 0) continue;
    for (const alt of alternatives(slot.ref)) {
      if (typeof alt === "number") continue;
      const idx = header.findIndex((h, i) => !used.has(i) && h !== "" && h.includes(alt));
      if (idx >= 0) {
        slot.idx = idx;
        used.add(idx);
        break;
      }
    }
  }
  const sets: ResolvedColumnSets = {};
  for (const slot of slots) {
    if (slot.idx < 0) continue;
    (sets[slot.field] ??= []).push(slot.idx);
  }
  return sets;
}

// The first (primary) column of each field.
export function resolveColumns(headerCells: Cell[], profile: Pick<BankProfile, "columnMap">): ResolvedColumns {
  const sets = resolveColumnSets(headerCells, profile);
  const resolved: ResolvedColumns = {};
  for (const [field, cols] of Object.entries(sets) as [ProfileField, number[]][]) resolved[field] = cols[0];
  return resolved;
}

// Cell text as one line: XLSX's escaped carriage return (`_x000D_`) and real
// line breaks become « · », so a multi-line «Σχόλια» cell reads as one
// description instead of breaking the review table.
export function cleanCellText(value: string): string {
  if (!/[\r\n]|_x000D_/i.test(value)) return value.trim();
  return value
    .replace(/_x000D_/gi, "\r")
    .split(/\r\n|\r|\n/)
    .map((part) => part.trim())
    .filter(Boolean)
    .join(" · ");
}

// Lines that are never movements, whatever the profile says: the e-banking
// «Ημερομηνία Ενημέρωσης: …» stamp under the table (it has no date or amount
// in the movement columns, so it would otherwise be glued onto the last
// movement's description as a wrapped line).
const ALWAYS_FOOTER = /^(ΗΜΕΡΟΜΗΝΙΑ ΕΝΗΜΕΡΩΣΗΣ|ΗΜ\/ΝΙΑ ΕΝΗΜΕΡΩΣΗΣ|ΗΜΕΡΟΜΗΝΙΑ ΕΚΤΥΠΩΣΗΣ|ΗΜΕΡΟΜΗΝΙΑ ΔΗΜΙΟΥΡΓΙΑΣ)/;

// Header names for `raw`, made unique by position («Νόμισμα», «Νόμισμα (2)»)
// so a repeated header does not overwrite the first one's value.
export function uniqueHeaderNames(headerCells: Cell[]): string[] {
  const seen = new Map<string, number>();
  return headerCells.map((c, i) => {
    const name = cellText(c).trim() || `#${i + 1}`;
    const n = (seen.get(name) ?? 0) + 1;
    seen.set(name, n);
    return n === 1 ? name : `${name} (${n})`;
  });
}

export function missingRequiredColumns(columns: ResolvedColumns, profile: Pick<BankProfile, "signMode">): ProfileField[] {
  const missing: ProfileField[] = [];
  if (columns.date === undefined) missing.push("date");
  if (profile.signMode === "debit_credit") {
    if (columns.debit === undefined) missing.push("debit");
    if (columns.credit === undefined) missing.push("credit");
  } else {
    if (columns.amount === undefined) missing.push("amount");
    if (profile.signMode === "direction_column" && columns.direction === undefined) missing.push("direction");
  }
  return missing;
}

export interface ApplyContext {
  accountId: string | null;
}

export interface ApplyResult {
  rows: CanonicalRow[];
  statement: StatementSummary;
  footerRows: number[]; // 1-based file rows recognised as totals/footer
  warnings: string[];
}

function isBlankRow(row: Cell[] | undefined): boolean {
  return !row || row.every((c) => cellText(c).trim() === "");
}

export function applyProfile(grid: Grid, profile: BankProfile, headerRow: number, ctx: ApplyContext): ApplyResult {
  const headerCells = grid[headerRow] ?? [];
  const sets = resolveColumnSets(headerCells, profile);
  const columns: ResolvedColumns = {};
  for (const [field, cols] of Object.entries(sets) as [ProfileField, number[]][]) columns[field] = cols[0];
  const missing = missingRequiredColumns(columns, profile);
  if (missing.length > 0) {
    throw new ProfileMismatchError(`Λείπουν στήλες για τη μορφή «${profile.name}»: ${missing.join(", ")}`);
  }

  const headerNames = uniqueHeaderNames(headerCells);
  const footer = profile.footerPattern ? new RegExp(profile.footerPattern, "i") : null;
  const numberFormat = { decimal: profile.decimalSeparator } as const;
  const debitMarkers = new Set(profile.debitMarkers.map(normalizeGreek));
  const at = (row: Cell[], field: ProfileField): Cell => {
    const idx = columns[field];
    return idx === undefined ? null : (row[idx] ?? null);
  };
  // A joined field: every non-empty part, in map order, « · » between them.
  const text = (row: Cell[], field: ProfileField): string | null =>
    (sets[field] ?? [])
      .map((idx) => cleanCellText(cellText(row[idx] ?? null)))
      .filter(Boolean)
      .join(" · ") || null;

  const rows: CanonicalRow[] = [];
  const signed: (number | null)[] = [];
  const footerRows: number[] = [];
  const warnings: string[] = [];

  for (let r = headerRow + 1; r < grid.length; r++) {
    const row = grid[r];
    if (isBlankRow(row)) continue;
    const fileRow = r + 1;
    const firstText = normalizeGreek(row.map(cellText).find((c) => c.trim() !== "") ?? "");
    if ((footer && footer.test(firstText)) || ALWAYS_FOOTER.test(firstText)) {
      footerRows.push(fileRow);
      continue;
    }

    const dateCell = at(row, "date");
    const txDate = parseDate(dateCell, profile.dateFormat);
    if (!txDate && cellText(dateCell).trim() === "") {
      // No date at all. With no money either, it is the description wrapping
      // onto a second line (common in e-banking exports): glue it onto the
      // movement above. With money, it is a totals/summary line («Σύνολα
      // χρεώσεων ...»). A date-ish value we cannot read is an error instead.
      const moneyCells = (["amount", "debit", "credit"] as const).map((f) => cellText(at(row, f)).trim());
      const previous = rows[rows.length - 1];
      if (previous && moneyCells.every((c) => c === "")) {
        const extra = row.map(cellText).map(cleanCellText).filter(Boolean).join(" ");
        previous.description = [previous.description, extra].filter(Boolean).join(" ");
        previous.extracted = extractRefs(previous.description, previous.reference, previous.counterpartyName);
        previous.counterpartyAfm ??= previous.extracted.afms[0] ?? null;
        previous.counterpartyIban ??= previous.extracted.ibans[0] ?? null;
      } else {
        footerRows.push(fileRow);
      }
      continue;
    }

    const parseErrors: string[] = [];
    if (!txDate) parseErrors.push(`Μη αναγνωρίσιμη ημερομηνία: «${cellText(dateCell)}»`);

    let amountSigned: number | null = null;
    if (profile.signMode === "debit_credit") {
      const debit = parseGreekNumber(at(row, "debit"), numberFormat);
      const credit = parseGreekNumber(at(row, "credit"), numberFormat);
      const hasDebit = debit !== null && debit !== 0;
      const hasCredit = credit !== null && credit !== 0;
      if (hasDebit && hasCredit) parseErrors.push("Η γραμμή έχει και χρέωση και πίστωση.");
      else if (hasDebit) amountSigned = -Math.abs(debit);
      else if (hasCredit) amountSigned = Math.abs(credit);
    } else if (profile.signMode === "direction_column") {
      const value = parseGreekNumber(at(row, "amount"), numberFormat);
      const marker = normalizeGreek(cellText(at(row, "direction")));
      if (value !== null) amountSigned = debitMarkers.has(marker) || value < 0 ? -Math.abs(value) : Math.abs(value);
    } else {
      amountSigned = parseGreekNumber(at(row, "amount"), numberFormat);
    }
    if (amountSigned === null || amountSigned === 0) {
      parseErrors.push("Μη αναγνωρίσιμο ή μηδενικό ποσό.");
      amountSigned = null;
    }

    const valueDateCell = at(row, "value_date");
    const valueDate = valueDateCell === null || cellText(valueDateCell).trim() === "" ? null : parseDate(valueDateCell, profile.dateFormat);
    const description = text(row, "description");
    const reference = text(row, "reference");
    const counterpartyName = text(row, "counterparty");
    const ibanCell = text(row, "counterparty_iban");
    const extracted = extractRefs(description, reference, counterpartyName, ibanCell);
    const balanceCell = at(row, "balance");
    const balanceAfter = parseGreekNumber(balanceCell, numberFormat);

    const raw: Record<string, unknown> = {};
    headerNames.forEach((name, i) => {
      const c = row[i];
      raw[name] = c instanceof Date ? toIso(c) : (c ?? null);
    });

    rows.push({
      rowNo: fileRow,
      kind: "movement",
      raw,
      extracted,
      externalKey: null,
      txDate,
      valueDate,
      direction: amountSigned === null ? null : amountSigned < 0 ? "expense" : "income",
      amount: amountSigned === null ? null : Math.abs(amountSigned),
      description,
      counterpartyName,
      counterpartyAfm: extracted.afms[0] ?? null,
      counterpartyIban: ibanCell?.replace(/\s+/g, "").toUpperCase() || extracted.ibans[0] || null,
      reference: reference ?? extracted.rfs[0] ?? null,
      balanceAfter,
      parseErrors,
    });
    signed.push(amountSigned);
  }

  // External keys only for complete lines on a known account.
  if (ctx.accountId) {
    const complete = rows.map((row, i) => ({ row, s: signed[i] })).filter(({ row, s }) => row.txDate && s !== null);
    const keys = bankLineKeys(
      complete.map(({ row, s }) => ({
        accountId: ctx.accountId!,
        date: row.txDate!,
        signedAmount: s!,
        description: row.description,
        reference: row.reference,
        balanceAfter: row.balanceAfter,
      })),
    );
    complete.forEach(({ row }, i) => {
      row.externalKey = keys[i];
    });
  } else {
    warnings.push("Δεν επιλέχθηκε λογαριασμός — η ανίχνευση διπλοεγγραφών ανάμεσα σε αρχεία είναι ανενεργή.");
  }

  const statement = summarizeStatement(rows, signed);
  if (statement.balanceConsistent === false) {
    warnings.push(`Το τρέχον υπόλοιπο δεν συμφωνεί με τα ποσά σε ${statement.balanceMismatchRows.length} γραμμή/ές.`);
  }
  return { rows, statement, footerRows, warnings };
}

// Period, opening/closing balance and running-balance consistency. Tries
// both file orders (oldest-first and newest-first) and keeps the one with
// fewer mismatches.
export function summarizeStatement(rows: CanonicalRow[], signed: (number | null)[]): StatementSummary {
  const dates = rows.map((r) => r.txDate).filter((d): d is string => !!d).sort();
  const lines = rows
    .map((r, i) => ({ rowNo: r.rowNo, s: signed[i], bal: r.balanceAfter }))
    .filter((l): l is { rowNo: number; s: number; bal: number } => l.s !== null && l.bal !== null);

  const base: StatementSummary = {
    periodStart: dates[0] ?? null,
    periodEnd: dates[dates.length - 1] ?? null,
    openingBalance: null,
    closingBalance: null,
    balanceConsistent: null,
    balanceMismatchRows: [],
    order: null,
  };
  if (lines.length === 0) return base;

  const mismatches = (order: "asc" | "desc") => {
    const out: number[] = [];
    for (let i = 1; i < lines.length; i++) {
      const [prev, cur] = order === "asc" ? [lines[i - 1], lines[i]] : [lines[i], lines[i - 1]];
      if (toCents(prev.bal) + toCents(cur.s) !== toCents(cur.bal)) out.push(cur.rowNo);
    }
    return out;
  };
  const asc = mismatches("asc");
  const desc = mismatches("desc");
  // With a single line both orders are trivially consistent: say asc.
  const order = desc.length < asc.length ? "desc" : "asc";
  const bad = order === "asc" ? asc : desc;
  const first = order === "asc" ? lines[0] : lines[lines.length - 1];
  const last = order === "asc" ? lines[lines.length - 1] : lines[0];
  return {
    ...base,
    openingBalance: (toCents(first.bal) - toCents(first.s)) / 100,
    closingBalance: last.bal,
    balanceConsistent: bad.length === 0,
    balanceMismatchRows: bad,
    order,
  };
}
