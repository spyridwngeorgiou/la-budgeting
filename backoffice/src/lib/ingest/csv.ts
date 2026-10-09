// RFC 4180 CSV reader for bank exports. Greek e-banking CSVs are usually
// ';'-separated (the comma is the decimal mark), Windows line endings,
// sometimes a UTF-8 BOM, sometimes quoted fields with embedded newlines in
// the description. Pure string code -- Worker-safe.

export type Delimiter = "," | ";" | "\t" | "|";
const DELIMITERS: Delimiter[] = [";", ",", "\t", "|"];

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

// Count delimiter occurrences outside quotes on each of the first lines;
// the delimiter whose count is non-zero and most consistent wins. Ties go
// to ';' (the Greek default) by list order.
export function sniffDelimiter(text: string): Delimiter {
  const lines = stripBom(text).split(/\r\n|\n|\r/).filter((l) => l.trim() !== "").slice(0, 30);
  let best: Delimiter = ";";
  let bestScore = -1;
  for (const d of DELIMITERS) {
    const counts = lines.map((line) => {
      let n = 0;
      let quoted = false;
      for (const ch of line) {
        if (ch === '"') quoted = !quoted;
        else if (ch === d && !quoted) n++;
      }
      return n;
    });
    const nonZero = counts.filter((c) => c > 0);
    if (nonZero.length === 0) continue;
    // Most common count (the table body), weighted by how many lines share it.
    const freq = new Map<number, number>();
    for (const c of nonZero) freq.set(c, (freq.get(c) ?? 0) + 1);
    const [mode, modeLines] = [...freq.entries()].sort((x, y) => y[1] - x[1] || y[0] - x[0])[0];
    const score = modeLines * 100 + mode;
    if (score > bestScore) {
      bestScore = score;
      best = d;
    }
  }
  return best;
}

export interface CsvOptions {
  delimiter?: Delimiter | null;
}

// Returns every record as an array of raw strings (no trimming -- callers
// decide). Blank lines are kept as [""] so row numbers match the file.
// A trailing newline does not produce an extra empty record.
export function parseCsv(text: string, options: CsvOptions = {}): string[][] {
  const input = stripBom(text);
  const delimiter = options.delimiter ?? sniffDelimiter(input);
  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let quoted = false;
  let i = 0;

  while (i < input.length) {
    const ch = input[i];
    if (quoted) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }
    if (ch === '"' && field === "") {
      quoted = true;
      i++;
      continue;
    }
    if (ch === delimiter) {
      record.push(field);
      field = "";
      i++;
      continue;
    }
    if (ch === "\r" || ch === "\n") {
      record.push(field);
      records.push(record);
      record = [];
      field = "";
      i += ch === "\r" && input[i + 1] === "\n" ? 2 : 1;
      continue;
    }
    field += ch;
    i++;
  }
  if (field !== "" || record.length > 0) {
    record.push(field);
    records.push(record);
  }
  return records;
}
