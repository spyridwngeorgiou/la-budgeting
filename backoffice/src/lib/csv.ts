function csvEscape(value: string | number | null | undefined): string {
  const s = value == null ? "" : String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// UTF-8 BOM so Excel (the realistic destination) renders Greek characters
// correctly instead of mojibake -- proven working on the transactions export.
export function toCsv(header: string[], rows: (string | number | null | undefined)[][]): string {
  const csv = [header, ...rows].map((r) => r.map(csvEscape).join(",")).join("\r\n");
  return "﻿" + csv;
}

export function csvResponseHeaders(filenamePrefix: string): HeadersInit {
  return {
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="${filenamePrefix}-${new Date().toISOString().slice(0, 10)}.csv"`,
  };
}
