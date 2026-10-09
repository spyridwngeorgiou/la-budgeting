import { parseCsv } from "../csv";
import { decodeBytes, type TextEncoding } from "../decode";
import { applyProfile } from "../profiles/apply";
import { detectProfile } from "../profiles/detect";
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
}

export async function parseBankFile(
  file: UploadedFile,
  profiles: BankProfile[],
  ctx: AdapterContext,
  forced?: { profile: BankProfile; headerRow: number },
): Promise<BankFileResult> {
  const { grid, fileKind, encoding } = await readBankGrid(file, forced?.profile);
  const layout = forced ?? detectProfile(grid, profiles);
  if (!layout) {
    return {
      batch: { source: "bank_file", rows: [], statement: null, profileId: null, warnings: [] },
      grid,
      fileKind,
      encoding,
      profile: null,
      headerRow: null,
      needsMapping: true,
    };
  }
  const applied = applyProfile(grid, layout.profile, layout.headerRow, { accountId: ctx.accountId });
  const warnings = [...applied.warnings];
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
