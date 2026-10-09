import ExcelJS from "exceljs";
import type { Cell, Grid } from "./profiles/types";

// First worksheet of an .xlsx as a plain grid. ExcelJS is already the AADE
// importer's reader and runs in the Worker build. Legacy binary .xls (BIFF,
// what several Greek e-banking sites still offer) is NOT readable by ExcelJS
// -- sniffFileKind below catches it so the user gets a clear message.

function toCell(value: ExcelJS.CellValue): Cell {
  if (value === null || value === undefined) return null;
  if (value instanceof Date || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "object") {
    if ("richText" in value) return value.richText.map((p) => p.text).join("");
    if ("text" in value) return String(value.text);
    if ("result" in value) return toCell(value.result as ExcelJS.CellValue);
    if ("error" in value) return null;
  }
  return String(value);
}

export async function readXlsxGrid(bytes: Uint8Array): Promise<Grid> {
  const workbook = new ExcelJS.Workbook();
  // ExcelJS's typings want a Node Buffer; at runtime any ArrayBuffer works.
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  await workbook.xlsx.load(buffer as unknown as Parameters<typeof workbook.xlsx.load>[0]);
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new Error("Το αρχείο δεν περιέχει φύλλα.");
  const grid: Grid = [];
  sheet.eachRow({ includeEmpty: true }, (row, rowNumber) => {
    const cells: Cell[] = [];
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      cells[colNumber - 1] = toCell(cell.value);
    });
    grid[rowNumber - 1] = Array.from(cells, (c) => c ?? null);
  });
  return Array.from(grid, (r) => r ?? []);
}

export type FileKind = "csv" | "xlsx" | "xls" | "pdf" | "unknown";

// By content, not by extension: banks name CSVs .xls surprisingly often.
export function sniffFileKind(bytes: Uint8Array, filename = ""): FileKind {
  const b = bytes;
  if (b.length >= 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04) return "xlsx";
  if (b.length >= 8 && b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0) return "xls";
  if (b.length >= 4 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return "pdf";
  // An HTML table saved as .xls (another e-banking classic) is not CSV.
  const head = new TextDecoder("utf-8").decode(b.subarray(0, 512)).trimStart().toLowerCase();
  if (head.startsWith("<")) return "unknown";
  if (/\.(csv|txt|xls)$/i.test(filename) || b.length > 0) return "csv";
  return "unknown";
}
