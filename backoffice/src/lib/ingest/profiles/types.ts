import type { Delimiter } from "../csv";
import type { TextEncoding } from "../decode";
import type { DateFormat } from "../text";

// TypeScript side of bank_import_profiles (0053).

export const PROFILE_FIELDS = [
  "date",
  "value_date",
  "description",
  "amount",
  "debit",
  "credit",
  "direction",
  "balance",
  "reference",
  "counterparty",
  "counterparty_iban",
] as const;
export type ProfileField = (typeof PROFILE_FIELDS)[number];

// A header text, alternatives for it, or a 0-based column index (what the
// mapping wizard saves when the header itself is unhelpful).
export type ColumnRef = string | string[] | number;
export type ColumnMap = Partial<Record<ProfileField, ColumnRef>>;

export type SignMode = "signed" | "trailing_minus" | "debit_credit" | "direction_column";

export interface BankProfile {
  id: string | null; // null for an in-memory preset/draft not yet saved
  orgId: string | null; // null = built-in preset
  bankCode: string;
  name: string;
  fileKind: "csv" | "xlsx";
  encoding: TextEncoding;
  delimiter: Delimiter | null;
  headerSignature: string[];
  columnMap: ColumnMap;
  dateFormat: DateFormat;
  decimalSeparator: "," | ".";
  signMode: SignMode;
  debitMarkers: string[];
  footerPattern: string | null;
  verified: boolean;
}

// One cell as read from CSV (always a string) or XLSX (typed).
export type Cell = string | number | Date | boolean | null;
export type Grid = Cell[][];

// Shape of a bank_import_profiles row as selected from Supabase.
export interface BankProfileRow {
  id: string;
  org_id: string | null;
  bank_code: string;
  name: string;
  file_kind: string;
  encoding: string;
  delimiter: string | null;
  header_signature: string[];
  column_map: unknown;
  date_format: string;
  decimal_separator: string;
  sign_mode: SignMode;
  debit_markers: string[];
  footer_pattern: string | null;
  verified: boolean;
}

export function profileFromRow(row: BankProfileRow): BankProfile {
  return {
    id: row.id,
    orgId: row.org_id,
    bankCode: row.bank_code,
    name: row.name,
    fileKind: row.file_kind === "xlsx" ? "xlsx" : "csv",
    encoding: row.encoding === "windows-1253" ? "windows-1253" : "utf-8",
    delimiter: (row.delimiter as Delimiter | null) ?? null,
    headerSignature: row.header_signature ?? [],
    columnMap: (row.column_map ?? {}) as ColumnMap,
    dateFormat: (row.date_format as DateFormat) ?? "dd/MM/yyyy",
    decimalSeparator: row.decimal_separator === "." ? "." : ",",
    signMode: row.sign_mode,
    debitMarkers: row.debit_markers ?? [],
    footerPattern: row.footer_pattern,
    verified: row.verified,
  };
}
