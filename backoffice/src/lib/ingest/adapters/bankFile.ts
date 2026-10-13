import { parseCsv } from "../csv";
import { decodeBytes, type TextEncoding } from "../decode";
import { applyProfile } from "../profiles/apply";
import { detectProfile } from "../profiles/detect";
import { matchStatementAccount, readStatementHeader, type AccountIdentity, type StatementHeader } from "../profiles/header";
import type { BankProfile, Grid } from "../profiles/types";
import type { AdapterContext, IngestAdapter, ParsedBatch, UploadedFile } from "../types";
import { readXlsxGrid, sniffFileKind } from "../xlsx";

// Bank statement file (CSV / XLSX) -> canonical movements, via whichever
// profile fits. When none does, the caller gets the raw grid back with
// needsMapping, and the column-mapping wizard builds a profile from it.

export class UnsupportedFileError extends Error {}

export interface BankGrid {
  grid: Grid;
  fileKind: "csv" | "xlsx";
  encoding: TextEncoding | null; // null for xlsx (no text decoding involved)
}

export async function readBankGrid(file: UploadedFile, profile?: BankProfile | null): Promise<BankGrid> {
  const kind = sniffFileKind(file.bytes, file.name);
  if (kind === "xls") {
    throw new UnsupportedFileError(
      "Τα παλιά αρχεία .xls δεν υποστηρίζονται. Ανοίξτε το στο Excel και αποθηκεύστε το ως .xlsx ή .csv.",
    );
  }
  if (kind === "pdf") {
    throw new UnsupportedFileError("Τα PDF αντίγραφα κίνησης δεν υποστηρίζονται ακόμη — ανεβάστε CSV ή XLSX.");
  }
  if (kind === "unknown") {
    throw new UnsupportedFileError("Μη αναγνωρίσιμη μορφή αρχείου — ανεβάστε CSV ή XLSX.");
  }
  if (kind === "xlsx") {
    return { grid: await readXlsxGrid(file.bytes), fileKind: "xlsx", encoding: null };
  }
  const decoded = decodeBytes(file.bytes, profile?.encoding ?? null);
  return {
    grid: parseCsv(decoded.text, { delimiter: profile?.delimiter ?? null }),
    fileKind: "csv",
    encoding: decoded.encoding,
  };
}

export interface BankFileResult {
  batch: ParsedBatch;
  grid: Grid;
  fileKind: "csv" | "xlsx";
  encoding: TextEncoding | null;
  profile: BankProfile | null;
  headerRow: number | null;
  needsMapping: boolean;
  // IBAN / account number / period read above the table.
  header: StatementHeader;
  // The account the rows were keyed to: the caller's, else the one the
  // header identifies among `accounts`.
  accountId: string | null;
}

export interface ParseBankFileOptions {
  forced?: { profile: BankProfile; headerRow: number };
  // The org's accounts, to pick the statement's account from its header
  // when the caller did not choose one (and to warn when it chose another).
  accounts?: AccountIdentity[];
}

export async function parseBankFile(
  file: UploadedFile,
  profiles: BankProfile[],
  ctx: AdapterContext,
  options: ParseBankFileOptions = {},
): Promise<BankFileResult> {
  const { forced, accounts = [] } = options;
  const { grid, fileKind, encoding } = await readBankGrid(file, forced?.profile);
  const layout = forced ?? detectProfile(grid, profiles);
  const header = layout ? readStatementHeader(grid, layout.headerRow) : readStatementHeader(grid, Math.min(grid.length, 10));
  const fromHeader = matchStatementAccount(accounts, header);
  const accountId = ctx.accountId ?? fromHeader?.id ?? null;
  if (!layout) {
    return {
      batch: { source: "bank_file", rows: [], statement: null, profileId: null, warnings: [] },
      grid,
      fileKind,
      encoding,
      profile: null,
      headerRow: null,
      needsMapping: true,
      header,
      accountId,
    };
  }
  const applied = applyProfile(grid, layout.profile, layout.headerRow, { accountId });
  const warnings = [...applied.warnings];
  if (ctx.accountId && fromHeader && fromHeader.id !== ctx.accountId) {
    warnings.push(`Το IBAN / ο αριθμός του αρχείου αντιστοιχεί στον λογαριασμό «${fromHeader.name}», όχι σε αυτόν που επιλέξατε.`);
  }
  // The period the bank says it exported beats the first/last movement date
  // (a quiet first week would otherwise shift the opening-balance check).
  if (header.periodStart && header.periodEnd) {
    applied.statement.periodStart = header.periodStart;
    applied.statement.periodEnd = header.periodEnd;
  }
  if (!layout.profile.verified) {
    warnings.push(`Η μορφή «${layout.profile.name}» δεν έχει επιβεβαιωθεί με πραγματικό αρχείο — ελέγξτε τις γραμμές.`);
  }
  return {
    batch: {
      source: "bank_file",
      rows: applied.rows,
      statement: applied.statement,
      profileId: layout.profile.id,
      warnings,
    },
    grid,
    fileKind,
    encoding,
    profile: layout.profile,
    headerRow: layout.headerRow,
    needsMapping: false,
    header,
    accountId,
  };
}

export function createBankFileAdapter(profiles: BankProfile[]): IngestAdapter {
  return {
    source: "bank_file",
    canHandle: (file) => {
      const kind = sniffFileKind(file.bytes, file.name);
      return kind === "csv" || kind === "xlsx";
    },
    parse: async (file, ctx) => (await parseBankFile(file, profiles, ctx)).batch,
  };
}
