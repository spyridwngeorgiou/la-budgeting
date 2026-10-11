import { readFileSync } from "node:fs";
import path from "node:path";
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { detectCaptureKind, documentMimeType, looksLikeAade, xlsxStrings } from "./captureKind";

const ZIP = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]);
const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46]);
const OLE = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);

const fixture = (name: string) => new Uint8Array(readFileSync(path.join(import.meta.dirname, "__fixtures__", name)));

describe("detectCaptureKind", () => {
  it("sends photos and PDFs to the AI document reader", () => {
    expect(detectCaptureKind({ name: "IMG_0012.jpg", type: "image/jpeg", head: JPEG })).toEqual({ kind: "document" });
    expect(detectCaptureKind({ name: "invoice.pdf", type: "application/pdf", head: PDF })).toEqual({ kind: "document" });
    expect(detectCaptureKind({ name: "scan.png", type: "image/png" })).toEqual({ kind: "document" });
    // Content wins over a wrong extension.
    expect(detectCaptureKind({ name: "receipt.txt", type: "text/plain", head: PDF })).toEqual({ kind: "document" });
  });

  it("refuses iPhone HEIC photos and binary .xls", () => {
    expect(detectCaptureKind({ name: "IMG_1.HEIC", type: "" })).toEqual({ problem: "heic" });
    expect(detectCaptureKind({ name: "kinisi.xls", type: "application/vnd.ms-excel", head: OLE })).toEqual({ problem: "xls" });
  });

  it("sends CSV and text statements to the bank import, even named .xls", () => {
    const csv = new TextEncoder().encode("Ημ/νία;Περιγραφή;Ποσό\n");
    expect(detectCaptureKind({ name: "statement.csv", type: "text/csv", head: csv, text: "Ημ/νία;Περιγραφή" })).toEqual({ kind: "bank" });
    expect(detectCaptureKind({ name: "export.xls", type: "application/vnd.ms-excel", head: csv, text: "a;b" })).toEqual({ kind: "bank" });
    expect(detectCaptureKind({ name: "export.xls", type: "", head: csv, text: "<table>" })).toEqual({ problem: "type" });
  });

  it("tells an AADE export from a bank workbook by its columns or name", () => {
    const xlsx = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    expect(detectCaptureKind({ name: "a.xlsx", type: xlsx, head: ZIP, text: "<t>ΜΑΡΚ</t><t>ΑΦΜ ΕΚΔΟΤΗ</t>" })).toEqual({ kind: "aade" });
    expect(detectCaptureKind({ name: "2026-03_income.xlsx", type: xlsx, head: ZIP })).toEqual({ kind: "aade" });
    expect(detectCaptureKind({ name: "eurobank.xlsx", type: xlsx, head: ZIP, text: "Ημερομηνία Αιτιολογία" })).toEqual({ kind: "bank" });
  });

  it("rejects anything else", () => {
    expect(detectCaptureKind({ name: "notes.docx", type: "application/msword", head: ZIP })).toEqual({ problem: "type" });
    expect(detectCaptureKind({ name: "movie.mp4", type: "video/mp4" })).toEqual({ problem: "type" });
  });

  it("gives the AI reader a real MIME type", () => {
    expect(documentMimeType({ name: "x.bin", type: "", head: JPEG })).toBe("image/jpeg");
    expect(documentMimeType({ name: "scan.PDF", type: "" })).toBe("application/pdf");
    expect(documentMimeType({ name: "x.png", type: "image/png" })).toBe("image/png");
    expect(documentMimeType({ name: "x.csv", type: "text/csv" })).toBeNull();
  });

  it("matches the AADE markers case-insensitively", () => {
    expect(looksLikeAade("μαρκ … αφμ εκδοτη")).toBe(true);
    expect(looksLikeAade("ΜΑΡΚ only")).toBe(false);
  });
});

describe("xlsxStrings", () => {
  it("reads a bank workbook's text, which is not AADE", async () => {
    const bytes = fixture("eurobank.xlsx");
    const text = await xlsxStrings(bytes);
    expect(text).toBeTruthy();
    expect(detectCaptureKind({ name: "eurobank.xlsx", type: "", head: bytes.subarray(0, 8), text })).toEqual({ kind: "bank" });
  });

  it("finds the myDATA columns in an AADE-shaped workbook", async () => {
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet("Sheet1").addRow(["ΗΜΕΡΟΜΗΝΙΑ ΕΚΔΟΣΗΣ", "ΜΑΡΚ", "ΑΦΜ ΕΚΔΟΤΗ", "ΚΑΘΑΡΗ ΑΞΙΑ"]);
    const bytes = new Uint8Array(await wb.xlsx.writeBuffer());
    const text = await xlsxStrings(bytes);
    expect(detectCaptureKind({ name: "export.xlsx", type: "", head: bytes.subarray(0, 8), text })).toEqual({ kind: "aade" });
  });

  it("returns null for bytes that are not a zip", async () => {
    expect(await xlsxStrings(new Uint8Array([1, 2, 3, 4, 5]))).toBeNull();
  });
});
