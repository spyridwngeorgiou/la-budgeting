import ExcelJS from "exceljs";

// Mirrors aade_exports_master.py's cleaning rules exactly -- these are
// hard-won: a 15-digit ΜΑΡΚ read as a number becomes "4.00008883252876e14"
// and an ΑΦΜ loses its leading zeros, so every ID column must be read as
// text and re-normalised, never trusted as a number.
const AFM_COLUMNS = new Set(["ΑΦΜ ΕΚΔΟΤΗ", "ΑΦΜ ΛΗΠΤΗ"]);

export interface AadeParsedRow {
  rowNo: number;
  raw: Record<string, unknown>;
  issueDate: string | null; // ISO yyyy-mm-dd
  mydataMark: string | null;
  invoiceNumber: string | null;
  documentType: string | null;
  issuerAfm: string | null;
  receiverAfm: string | null;
  counterpartyName: string | null;
  kadCode: string | null;
  kadDescription: string | null;
  netAmount: number | null;
  grossAmount: number | null;
  vatAmount: number | null;
  withholdingAmount: number | null;
  digitalFee: number | null;
  fees: number | null;
  otherTaxes: number | null;
  deductions: number | null;
  discrepancy: string | null;
  parseErrors: string[];
}

// The columns actually used. Everything else in the row is kept verbatim in
// `raw` (see aade_staging_rows.raw jsonb) so a future AADE schema change is a
// backfill, not a re-download.
const HEADER_MAP = {
  date: "ΗΜΕΡΟΜΗΝΙΑ ΕΚΔΟΣΗΣ",
  mark: "ΜΑΡΚ",
  invoiceNumber: "ΑΡ. ΠΑΡΑΣΤΑΤΙΚΟΥ",
  documentType: "ΠΕΡΙΓΡΑΦΗ",
  issuerAfm: "ΑΦΜ ΕΚΔΟΤΗ",
  receiverAfm: "ΑΦΜ ΛΗΠΤΗ",
  counterpartyName: "Επωνυμία Αντισυμβαλλόμενου",
  kadCode: "ΚΑΔ Αντισυμβαλλόμενου",
  kadDescription: "ΚΑΔ Περιγραφή",
  net: "ΚΑΘΑΡΗ ΑΞΙΑ",
  gross: "ΣΥΝΟΛΙΚΗ ΑΞΙΑ",
  vat: "Φ.Π.Α.",
  withholding: "ΠΑΡΑΚΡ. ΦΟΡΟΙ",
  digitalFee: "ΨΗΦΙΑΚΟ ΤΕΛΟΣ ΣΥΝΑΛΛΑΓΗΣ",
  fees: "ΤΕΛΗ",
  otherTaxes: "ΑΛΛΟΙ ΦΟΡΟΙ",
  deductions: "ΚΡΑΤΗΣΕΙΣ",
  discrepancy: "Παράλειψη/Απόκλιση",
} as const;

function cleanId(value: unknown, padWidth?: number): string | null {
  if (value === null || value === undefined || value === "") return null;
  let s = String(value).trim();
  if (s.endsWith(".0")) s = s.slice(0, -2); // Excel's numeric-inference artefact
  s = s.replace(/\D/g, ""); // IDs (ΜΑΡΚ, ΑΦΜ, ΚΑΔ) are digits-only
  if (!s) return null;
  if (padWidth) s = s.padStart(padWidth, "0");
  return s;
}

function parseGreekDate(value: unknown): string | null {
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === "string") {
    // DD/MM/YYYY, the format myDATA exports use -- never new Date(string),
    // which would silently misparse this as MM/DD/YYYY.
    const m = value.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (m) {
      const [, d, mo, y] = m;
      return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
    }
  }
  return null;
}

function parseNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    // Some exports use comma decimals depending on locale settings.
    const normalized = value.trim().replace(/\./g, "").replace(",", ".");
    const n = Number(normalized.includes(",") || /,/.test(value) ? normalized : value);
    return Number.isFinite(n) ? n : Number(value.replace(",", ".")) || null;
  }
  return null;
}

function cellValue(cell: ExcelJS.Cell): unknown {
  const v = cell.value;
  if (v && typeof v === "object" && "text" in v) return (v as { text: string }).text;
  if (v && typeof v === "object" && "result" in v) return (v as { result: unknown }).result;
  return v;
}

export async function parseAadeWorkbook(buffer: ArrayBuffer): Promise<AadeParsedRow[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new Error("Το αρχείο δεν περιέχει φύλλα.");

  const headerRow = sheet.getRow(1);
  const columnIndex = new Map<string, number>();
  headerRow.eachCell((cell, colNumber) => {
    const text = String(cellValue(cell) ?? "").trim();
    if (text) columnIndex.set(text, colNumber);
  });

  const required = [HEADER_MAP.date, HEADER_MAP.issuerAfm, HEADER_MAP.receiverAfm, HEADER_MAP.gross];
  const missing = required.filter((h) => !columnIndex.has(h));
  if (missing.length > 0) {
    throw new Error(`Λείπουν αναμενόμενες στήλες: ${missing.join(", ")}`);
  }

  const get = (row: ExcelJS.Row, key: keyof typeof HEADER_MAP) => {
    const idx = columnIndex.get(HEADER_MAP[key]);
    return idx ? cellValue(row.getCell(idx)) : null;
  };

  const rows: AadeParsedRow[] = [];

  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const rawDate = get(row, "date");
    if (rawDate === null || rawDate === "") return; // blank trailing row

    const raw: Record<string, unknown> = {};
    columnIndex.forEach((colNumber, header) => {
      raw[header] = cellValue(row.getCell(colNumber));
    });

    const parseErrors: string[] = [];
    const issueDate = parseGreekDate(rawDate);
    if (!issueDate) parseErrors.push(`Μη αναγνωρίσιμη ημερομηνία: ${rawDate}`);

    rows.push({
      rowNo: rowNumber,
      raw,
      issueDate,
      mydataMark: cleanId(get(row, "mark")),
      invoiceNumber: (get(row, "invoiceNumber") as string | null) ?? null,
      documentType: (get(row, "documentType") as string | null) ?? null,
      issuerAfm: cleanId(get(row, "issuerAfm"), AFM_COLUMNS.has(HEADER_MAP.issuerAfm) ? 9 : undefined),
      receiverAfm: cleanId(get(row, "receiverAfm"), AFM_COLUMNS.has(HEADER_MAP.receiverAfm) ? 9 : undefined),
      counterpartyName: (get(row, "counterpartyName") as string | null)?.trim() || null,
      kadCode: cleanId(get(row, "kadCode")),
      kadDescription: (get(row, "kadDescription") as string | null) ?? null,
      netAmount: parseNumber(get(row, "net")),
      grossAmount: parseNumber(get(row, "gross")),
      vatAmount: parseNumber(get(row, "vat")),
      withholdingAmount: parseNumber(get(row, "withholding")),
      digitalFee: parseNumber(get(row, "digitalFee")),
      fees: parseNumber(get(row, "fees")),
      otherTaxes: parseNumber(get(row, "otherTaxes")),
      deductions: parseNumber(get(row, "deductions")),
      discrepancy: (get(row, "discrepancy") as string | null) ?? null,
      parseErrors,
    });
  });

  return rows;
}
