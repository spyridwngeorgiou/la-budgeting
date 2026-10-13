// «＋ Καταχώριση» (/inbox/new): which existing upload a dropped file goes
// to. Pure and dependency-free so the client bundle stays small (xlsx.ts
// pulls in ExcelJS) and vitest can cover it.
//
//   image / PDF            -> uploadDocument (AI reads the receipt)
//   PDF named like a statement -> uploadBankStatement (AI statement reader)
//   .xlsx with myDATA cols -> uploadAadeFile
//   .csv / .txt / .xlsx    -> uploadBankStatement
//
// Content beats extension: the magic bytes say what the file really is,
// and the header text (CSV head, or the .xlsx shared strings) tells an AADE
// export from a bank statement.

export type CaptureKind = "document" | "bank" | "aade";
export type CaptureProblem = "heic" | "xls" | "type";

export interface CaptureFileInfo {
  name: string;
  type: string;
  // First bytes of the file (8 are enough).
  head?: Uint8Array | null;
  // Decoded text sample: the CSV head or the workbook's strings.
  text?: string | null;
}

export type CaptureDetection = { kind: CaptureKind } | { problem: CaptureProblem };

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const IMAGE_EXT = new Set(["jpg", "jpeg", "png", "webp"]);
const SHEET_TYPES = new Set([
  "text/csv",
  "text/plain",
  "application/vnd.ms-excel", // Windows labels .csv this way too
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);

// Column titles of a myDATA export (lib/aade/parse.ts HEADER_MAP). Two of
// them together never appear in a bank statement.
const AADE_MARKERS = ["ΜΑΡΚ", "ΑΦΜ ΕΚΔΟΤΗ"];
// The file name myDATA gives its exports (lib/ingest/adapters/aadeFile.ts).
const AADE_NAME = /^\d{4}-\d{2}_(expenses|income)\.xlsx$/i;

type Magic = "zip" | "ole" | "pdf" | "jpeg" | "png" | "webp" | null;

function magicOf(b: Uint8Array | null | undefined): Magic {
  if (!b || b.length < 4) return null;
  if (b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04) return "zip";
  if (b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0) return "ole";
  if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return "pdf";
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpeg";
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "png";
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45) {
    return "webp";
  }
  return null;
}

export function looksLikeAade(text: string | null | undefined): boolean {
  if (!text) return false;
  const upper = text.toLocaleUpperCase("el");
  return AADE_MARKERS.every((m) => upper.includes(m));
}

export function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot < 0 ? "" : name.slice(dot + 1).toLowerCase();
}

// A PDF's text is compressed, so the browser cannot read it cheaply; the
// name the bank gives its export is the hint («accountTransactionHistory»,
// «Κινήσεις λογαριασμού», «statement», «extrait»). The user can still switch
// between «Παραστατικό» and «Τραπεζικό αρχείο» before uploading.
const STATEMENT_NAME = /(transaction|statement|extrait|kinhseis|kiniseis|κινησ|ιστορικ|αντιγραφ)/;

export function looksLikeStatementName(name: string): boolean {
  // Accents off, lower case: «Κινήσεις» and «ΚΙΝΗΣΕΙΣ» alike.
  return STATEMENT_NAME.test(name.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase());
}

export function isPdfFile(file: CaptureFileInfo): boolean {
  const magic = magicOf(file.head);
  return magic === "pdf" || (!magic && (file.type.toLowerCase() === "application/pdf" || extensionOf(file.name) === "pdf"));
}

export function detectCaptureKind(file: CaptureFileInfo): CaptureDetection {
  const ext = extensionOf(file.name);
  const type = file.type.toLowerCase();
  const magic = magicOf(file.head);

  if (type === "image/heic" || type === "image/heif" || ext === "heic" || ext === "heif") return { problem: "heic" };

  // A PDF bank statement (read by the AI statement reader), else receipts
  // and invoices.
  if (isPdfFile(file) && looksLikeStatementName(file.name)) return { kind: "bank" };
  if (magic === "pdf" || magic === "jpeg" || magic === "png" || magic === "webp") return { kind: "document" };
  if (!magic && (type === "application/pdf" || ext === "pdf" || IMAGE_TYPES.has(type) || IMAGE_EXT.has(ext))) {
    return { kind: "document" };
  }

  // Old binary Excel: neither importer reads it.
  if (magic === "ole") return { problem: "xls" };

  // A workbook: AADE export or bank statement.
  if (magic === "zip" || (!magic && ext === "xlsx")) {
    if (magic === "zip" && ext !== "xlsx" && !SHEET_TYPES.has(type)) return { problem: "type" };
    return { kind: looksLikeAade(file.text) || AADE_NAME.test(file.name) ? "aade" : "bank" };
  }

  // Plain text: a bank CSV (banks often name these .xls).
  if (ext === "csv" || ext === "txt" || ext === "xls" || type === "text/csv" || type === "text/plain") {
    const head = (file.text ?? "").trimStart();
    if (head.startsWith("<")) return { problem: "type" }; // an HTML table saved as .xls
    return { kind: "bank" };
  }

  return { problem: "type" };
}

// The MIME type the AI reader needs for a "document": what the bytes say,
// else the browser's label, else the extension (some phones send "").
export function documentMimeType(file: CaptureFileInfo): string | null {
  const byMagic = { pdf: "application/pdf", jpeg: "image/jpeg", png: "image/png", webp: "image/webp" } as const;
  const magic = magicOf(file.head);
  if (magic && magic in byMagic) return byMagic[magic as keyof typeof byMagic];
  const type = file.type.toLowerCase();
  if (type === "application/pdf" || IMAGE_TYPES.has(type)) return type;
  const ext = extensionOf(file.name);
  if (ext === "pdf") return "application/pdf";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "png" || ext === "webp") return `image/${ext}`;
  return null;
}

// Workbook text for detectCaptureKind: the shared strings (or the first
// sheet) of an .xlsx, read straight from the zip with the browser's own
// inflater. null when anything is off -- the name then decides.
export async function xlsxStrings(bytes: Uint8Array): Promise<string | null> {
  try {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    // End of central directory: scan back over a possible zip comment.
    let eocd = -1;
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
      if (view.getUint32(i, true) === 0x06054b50) {
        eocd = i;
        break;
      }
    }
    if (eocd < 0) return null;
    const entries = view.getUint16(eocd + 10, true);
    let p = view.getUint32(eocd + 16, true);
    const wanted = ["xl/sharedStrings.xml", "xl/worksheets/sheet1.xml"];
    const found = new Map<string, { method: number; size: number; offset: number }>();
    const decoder = new TextDecoder("utf-8");
    for (let n = 0; n < entries && p + 46 <= bytes.length; n++) {
      if (view.getUint32(p, true) !== 0x02014b50) return null;
      const method = view.getUint16(p + 10, true);
      const size = view.getUint32(p + 20, true);
      const nameLen = view.getUint16(p + 28, true);
      const extraLen = view.getUint16(p + 30, true);
      const commentLen = view.getUint16(p + 32, true);
      const offset = view.getUint32(p + 42, true);
      const name = decoder.decode(bytes.subarray(p + 46, p + 46 + nameLen));
      if (wanted.includes(name)) found.set(name, { method, size, offset });
      p += 46 + nameLen + extraLen + commentLen;
    }
    const entry = found.get(wanted[0]) ?? found.get(wanted[1]);
    if (!entry || entry.size > 8 * 1024 * 1024) return null;
    const local = entry.offset;
    if (view.getUint32(local, true) !== 0x04034b50) return null;
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const data = bytes.slice(start, start + entry.size);
    if (entry.method === 0) return decoder.decode(data);
    if (entry.method !== 8 || typeof DecompressionStream === "undefined") return null;
    const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    return decoder.decode(await new Response(stream).arrayBuffer());
  } catch {
    return null;
  }
}
