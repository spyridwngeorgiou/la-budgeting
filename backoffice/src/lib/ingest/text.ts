import { isValidAfm } from "@/lib/finance/money";
import { toIso } from "@/lib/dates";

// Text helpers shared by every ingest adapter. Pure functions only -- no
// Node built-ins, so this runs unchanged in a Cloudflare Worker, the browser
// and vitest.

// Uppercase, accents and diaeresis stripped, whitespace collapsed. Greek
// banks are inconsistent about all three («Ημ/νία Αξίας», «ΗΜ/ΝΙΑ ΑΞΙΑΣ»,
// «ημ/νια  αξιας»), and so are people typing contact names. Uppercasing
// also folds final sigma (ς -> Σ).
export function normalizeGreek(input: string | null | undefined): string {
  if (!input) return "";
  return input
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[ \s]+/g, " ")
    .trim();
}

// Name comparison key: normalised, punctuation dropped, common company-form
// suffixes removed («ΑΕ», «Ε.Π.Ε.», «ΙΚΕ», «Ο.Ε.»...) so «ΔΕΗ Α.Ε.» and
// «ΔΕΗ ΑΝΩΝΥΜΗ ΕΤΑΙΡΕΙΑ» compare on «ΔΕΗ».
const COMPANY_FORMS = new Set([
  "ΑΕ", "ΑΝΩΝΥΜΗ", "ΕΤΑΙΡΕΙΑ", "ΕΤΑΙΡΙΑ", "ΕΠΕ", "ΙΚΕ", "ΟΕ", "ΕΕ", "ΜΟΝΟΠΡΟΣΩΠΗ", "ΜΟΝ", "ΚΑΙ", "ΣΙΑ",
  "SA", "LTD", "AE", "IKE", "EPE", "OE",
]);
export function nameTokens(input: string | null | undefined): string[] {
  return normalizeGreek(input)
    .replace(/[.,'"«»()\-/&]/g, " ")
    .split(" ")
    .map((t) => t.trim())
    .filter((t) => t.length >= 2 && !COMPANY_FORMS.has(t));
}

export interface NumberFormat {
  // ',' for Greek exports (1.234,56). '.' for 1,234.56. 'auto' guesses per value.
  decimal?: "," | "." | "auto";
}

// Parse an amount as Greek banks print it. Handles:
//   1.234,56   -1.234,56   1.234,56-   (1.234,56)   +1.234,56   € 1.234,56
//   1 234,56 (space / NBSP thousands)   1234.56 with decimal '.'
// Returns a signed number, or null for blank / unparseable input -- never 0
// for garbage, so a misread column is a visible error, not a silent zero.
export function parseGreekNumber(input: unknown, format: NumberFormat = {}): number | null {
  if (input === null || input === undefined) return null;
  if (typeof input === "number") return Number.isFinite(input) ? input : null;
  let s = String(input).trim();
  if (!s) return null;

  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1).trim();
  }
  s = s.replace(/(€|EUR|ΕΥΡΩ)/gi, "").replace(/[ \s]/g, "");
  if (s.endsWith("-")) {
    negative = !negative;
    s = s.slice(0, -1);
  } else if (s.endsWith("+")) {
    s = s.slice(0, -1);
  }
  if (s.startsWith("-")) {
    negative = !negative;
    s = s.slice(1);
  } else if (s.startsWith("+")) {
    s = s.slice(1);
  }
  if (!/^[0-9.,]+$/.test(s) || !/[0-9]/.test(s)) return null;

  const decimal = format.decimal ?? "auto";
  let normalized: string;
  if (decimal === ",") {
    normalized = s.replace(/\./g, "").replace(",", ".");
    if (/,/.test(normalized)) return null; // two decimal commas
  } else if (decimal === ".") {
    normalized = s.replace(/,/g, "");
  } else {
    const lastComma = s.lastIndexOf(",");
    const lastDot = s.lastIndexOf(".");
    if (lastComma >= 0 && lastDot >= 0) {
      // Both present: whichever comes last is the decimal mark.
      normalized = lastComma > lastDot ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
    } else if (lastComma >= 0) {
      // Comma only: a decimal comma, unless it is clearly a thousands
      // grouping (1,234,567).
      normalized = /^\d{1,3}(,\d{3}){2,}$/.test(s) ? s.replace(/,/g, "") : s.replace(",", ".");
    } else if (lastDot >= 0) {
      // Dot only: Greek-style thousands («1.234», «12.345.678») when every
      // group after the first is exactly three digits, else a decimal point.
      normalized = /^\d{1,3}(\.\d{3})+$/.test(s) ? s.replace(/\./g, "") : s;
    } else {
      normalized = s;
    }
  }
  if ((normalized.match(/\./g) ?? []).length > 1) return null;
  const n = Number(normalized);
  if (!Number.isFinite(n)) return null;
  return negative ? -n : n;
}

// Supported date layouts. Tokens: dd, MM, yyyy, yy. Separators are matched
// loosely (/, -, . or space), so «dd/MM/yyyy» also reads 05-03-2026.
export type DateFormat = "dd/MM/yyyy" | "dd/MM/yy" | "yyyy-MM-dd" | "MM/dd/yyyy";

const EXCEL_EPOCH_UTC = Date.UTC(1899, 11, 30);

function isoIfValid(y: number, m: number, d: number): string | null {
  if (y < 1900 || y > 2200 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return toIso(date);
}

// Never new Date(string): it reads 05/03/2026 as May 3rd. A JS Date (from
// ExcelJS) is taken at its UTC calendar day -- ExcelJS builds cell dates at
// UTC midnight. A bare number in a date column is an Excel serial.
export function parseDate(input: unknown, format: DateFormat = "dd/MM/yyyy"): string | null {
  if (input === null || input === undefined || input === "") return null;
  if (input instanceof Date) {
    return Number.isNaN(input.getTime()) ? null : toIso(input);
  }
  if (typeof input === "number") {
    if (input < 1 || input > 120000) return null;
    return toIso(new Date(EXCEL_EPOCH_UTC + Math.floor(input) * 86_400_000));
  }
  const s = String(input).trim();
  // A trailing time («05/03/2026 14:22») is common; ignore it.
  const parts = s.split(/[\sT]+/)[0].split(/[/.\-]/).filter(Boolean);
  if (parts.length !== 3 || parts.some((p) => !/^\d+$/.test(p))) return null;
  const [a, b, c] = parts.map(Number);
  switch (format) {
    case "dd/MM/yyyy":
      // Also tolerate an ISO date in a Greek-format column.
      if (parts[0].length === 4) return isoIfValid(a, b, c);
      return parts[2].length === 4 ? isoIfValid(c, b, a) : parts[2].length === 2 ? isoIfValid(2000 + c, b, a) : null;
    case "dd/MM/yy":
      return parts[2].length === 2 ? isoIfValid(2000 + c, b, a) : isoIfValid(c, b, a);
    case "yyyy-MM-dd":
      return parts[0].length === 4 ? isoIfValid(a, b, c) : null;
    case "MM/dd/yyyy":
      return parts[2].length === 4 ? isoIfValid(c, a, b) : null;
  }
}

// ΑΦΜ in free text: 9-digit runs not part of a longer number (an IBAN or a
// ΜΑΡΚ contains plenty of those), checksum-validated. One labelled «ΑΦΜ»
// comes first.
export function extractAfms(text: string | null | undefined): string[] {
  if (!text) return [];
  const labelled: string[] = [];
  const plain: string[] = [];
  const upper = normalizeGreek(text);
  for (const m of upper.matchAll(/(?<![0-9A-Z])(ΑΦΜ|A\.?F\.?M\.?|VAT)?[\s:.#]*(?:EL|GR)?(\d{9})(?!\d)/g)) {
    const afm = m[2];
    if (!isValidAfm(afm)) continue;
    (m[1] ? labelled : plain).push(afm);
  }
  return [...new Set([...labelled, ...plain])];
}

export function extractAfm(text: string | null | undefined): string | null {
  return extractAfms(text)[0] ?? null;
}

// ISO 13616 mod-97 on the rearranged IBAN, digit-by-digit so it never
// overflows a JS number.
function mod97(s: string): number {
  const rearranged = s.slice(4) + s.slice(0, 4);
  let rem = 0;
  for (const ch of rearranged) {
    const v = ch >= "A" && ch <= "Z" ? String(ch.charCodeAt(0) - 55) : ch;
    for (const digit of v) rem = (rem * 10 + Number(digit)) % 97;
  }
  return rem;
}

export function isValidIban(iban: string): boolean {
  const s = iban.replace(/\s+/g, "").toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(s)) return false;
  if (s.startsWith("GR") && s.length !== 27) return false;
  return mod97(s) === 1;
}

// IBANs in free text, spaces allowed in groups of four, normalised to
// compact uppercase and checksum-validated.
export function extractIbans(text: string | null | undefined): string[] {
  if (!text) return [];
  const found = new Set<string>();
  for (const m of text.toUpperCase().matchAll(/\b([A-Z]{2}\d{2}(?:\s?[A-Z0-9]){11,30})\b/g)) {
    // Greedy match may swallow a trailing word; trim back until valid.
    let candidate = m[1].replace(/\s+/g, "");
    while (candidate.length >= 15) {
      if (isValidIban(candidate)) {
        found.add(candidate);
        break;
      }
      candidate = candidate.slice(0, -1);
    }
  }
  return [...found];
}

export function extractIban(text: string | null | undefined): string | null {
  return extractIbans(text)[0] ?? null;
}

// ISO 11649 creditor reference («RF18 5390 0754 7034»), used by Greek
// utilities and the tax office for payment codes. Same mod-97 as IBAN.
export function isValidRf(rf: string): boolean {
  const s = rf.replace(/\s+/g, "").toUpperCase();
  if (!/^RF\d{2}[A-Z0-9]{1,21}$/.test(s)) return false;
  return mod97(s) === 1;
}

export function extractRfs(text: string | null | undefined): string[] {
  if (!text) return [];
  const found = new Set<string>();
  for (const m of text.toUpperCase().matchAll(/\bRF\s?\d{2}(?:\s?[A-Z0-9]){1,21}\b/g)) {
    let candidate = m[0].replace(/\s+/g, "");
    while (candidate.length >= 5) {
      if (mod97(candidate) === 1) {
        found.add(candidate);
        break;
      }
      candidate = candidate.slice(0, -1);
    }
  }
  return [...found];
}

export function extractRf(text: string | null | undefined): string | null {
  return extractRfs(text)[0] ?? null;
}

// myDATA ΜΑΡΚ: a 15-digit number (they start with 4 today). Kept loose --
// only ever compared against marks already on transactions.
export function extractMarks(text: string | null | undefined): string[] {
  if (!text) return [];
  return [...new Set([...text.matchAll(/(?<!\d)(\d{15})(?!\d)/g)].map((m) => m[1]))];
}

export interface ExtractedRefs {
  afms: string[];
  ibans: string[];
  rfs: string[];
  marks: string[];
}

export function extractRefs(...texts: (string | null | undefined)[]): ExtractedRefs {
  const text = texts.filter(Boolean).join(" ");
  return { afms: extractAfms(text), ibans: extractIbans(text), rfs: extractRfs(text), marks: extractMarks(text) };
}
