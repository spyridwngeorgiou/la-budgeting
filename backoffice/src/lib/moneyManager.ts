// Money Manager (Realbyte) Excel export -> staged cash rows.
//
// The export has one header row; column names depend on the phone's language
// (English or Greek), so they are matched by meaning, not position. Only the
// cash account is matched against the ledger; other accounts (cards) come
// from the bank side and are marked 'not_cash'.

import ExcelJS from "exceljs";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

export type MmRow = {
  rowNo: number;
  date: string; // yyyy-mm-dd
  account: string | null;
  category: string | null;
  subcategory: string | null;
  note: string | null;
  amount: number;
  kind: "expense" | "income" | "transfer";
  raw: Record<string, unknown>;
};

const HEADERS: Record<keyof Omit<MmRow, "rowNo" | "raw" | "kind"> | "type" | "description", RegExp> = {
  date: /^(period|date|ημερομηνία|περίοδος)$/i,
  account: /^(accounts?|λογαριασμ)/i,
  category: /^(category|κατηγορία)$/i,
  subcategory: /^(subcategory|υποκατηγορία)$/i,
  note: /^(note|σημείωση|σημειώσεις)$/i,
  amount: /^(eur|amount|ποσό|€)$/i,
  type: /^(income\/expense|έσοδα\/έξοδα|έσοδο\/έξοδο|τύπος|type)$/i,
  description: /^(description|περιγραφή)$/i,
};

const cellValue = (c: ExcelJS.Cell): unknown => {
  const v = c.value;
  if (v && typeof v === "object" && "text" in v) return (v as { text: string }).text;
  if (v && typeof v === "object" && "result" in v) return (v as { result: unknown }).result;
  return v;
};

function toIsoDate(v: unknown): string | null {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v ?? "").trim();
  let m = s.match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = s.match(/^(\d{1,2})[-./](\d{1,2})[-./](\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return null;
}

function kindOf(v: unknown): MmRow["kind"] | null {
  const s = String(v ?? "").toLowerCase();
  if (/^exp|έξοδ/.test(s)) return "expense";
  if (/^inc|έσοδ/.test(s)) return "income";
  if (/trans|μεταφ/.test(s)) return "transfer";
  return null;
}

export async function parseMoneyManager(buffer: ArrayBuffer): Promise<MmRow[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const sheet = wb.worksheets[0];
  if (!sheet) throw new Error("Το αρχείο δεν έχει φύλλα.");
  const col = new Map<string, number>();
  const headers: string[] = [];
  sheet.getRow(1).eachCell((c, n) => {
    const h = String(cellValue(c) ?? "").trim();
    headers[n] = h;
    for (const [key, re] of Object.entries(HEADERS)) if (re.test(h) && !col.has(key)) col.set(key, n);
  });
  for (const need of ["date", "amount", "type"]) {
    if (!col.has(need)) throw new Error(`Δεν αναγνωρίστηκε η στήλη «${need}». Στήλες: ${headers.filter(Boolean).join(", ")}`);
  }
  const get = (r: ExcelJS.Row, key: string) => (col.has(key) ? cellValue(r.getCell(col.get(key)!)) : null);
  const text = (v: unknown) => (v == null || String(v).trim() === "" ? null : String(v).trim());

  const rows: MmRow[] = [];
  sheet.eachRow((r, n) => {
    if (n === 1) return;
    const date = toIsoDate(get(r, "date"));
    const kind = kindOf(get(r, "type"));
    const amount = Math.abs(Number(String(get(r, "amount") ?? "").toString().replace(",", ".")));
    if (!date || !kind || !Number.isFinite(amount) || amount === 0) return;
    const raw: Record<string, unknown> = {};
    headers.forEach((h, i) => h && (raw[h] = cellValue(r.getCell(i))));
    rows.push({
      rowNo: n, date, kind, amount: Math.round(amount * 100) / 100,
      account: text(get(r, "account")), category: text(get(r, "category")), subcategory: text(get(r, "subcategory")),
      note: text(get(r, "note")) ?? text(get(r, "description")), raw: JSON.parse(JSON.stringify(raw)),
    });
  });
  return rows;
}

const isCash = (account: string | null) => !account || /cash|μετρητ/i.test(account);
const day = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

// Stage an export: rows already in the ledger (cash, same direction, same
// amount, date ±1 day — each ledger row used once) are 'exists'.
export async function stageMoneyManager(
  supabase: SupabaseClient,
  orgId: string,
  file: { name: string | null; buffer: ArrayBuffer; storagePath: string | null },
) {
  const rows = await parseMoneyManager(file.buffer);
  if (!rows.length) throw new Error("Δεν βρέθηκαν κινήσεις στο αρχείο.");
  const sha = createHash("sha256").update(Buffer.from(file.buffer)).digest("hex");
  const { data: dup } = await supabase.from("mm_imports").select("id").eq("org_id", orgId).eq("file_sha256", sha).maybeSingle();
  if (dup) return { importId: dup.id as string, rows: rows.length, fresh: 0, exists: rows.length, already: true };

  const dates = rows.map((r) => r.date).sort();
  const { data: cashAcc } = await supabase.from("accounts").select("id").eq("org_id", orgId).eq("kind", "cash");
  const cashIds = (cashAcc ?? []).map((a) => a.id);
  const { data: ledger } = await supabase
    .from("transactions")
    .select("id, tx_date, paid_on, gross_amount, direction")
    .eq("org_id", orgId)
    .in("account_id", cashIds.length ? cashIds : ["00000000-0000-0000-0000-000000000000"])
    .eq("status", "paid")
    .gte("tx_date", day(dates[0], -1))
    .lte("tx_date", day(dates[dates.length - 1], 1));
  const used = new Set<string>();

  const staged = rows.map((r) => {
    if (r.kind === "transfer" || !isCash(r.account)) return { r, status: "not_cash" as const, match: null as string | null };
    const dir = r.kind === "income" ? "income" : "expense";
    const hit = (ledger ?? []).find(
      (t) => !used.has(t.id) && t.direction === dir && Math.abs(Number(t.gross_amount) - r.amount) < 0.005 &&
        [day(r.date, -1), r.date, day(r.date, 1)].includes(String(t.paid_on ?? t.tx_date)),
    );
    if (hit) used.add(hit.id);
    return { r, status: hit ? ("exists" as const) : ("new" as const), match: hit?.id ?? null };
  });
  const fresh = staged.filter((s) => s.status === "new").length;

  const { data: imp, error } = await supabase
    .from("mm_imports")
    .insert({ org_id: orgId, filename: file.name, storage_path: file.storagePath, file_sha256: sha, period_from: dates[0], period_to: dates[dates.length - 1], row_count: rows.length, new_count: fresh })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  const { error: rowsError } = await supabase.from("mm_rows").insert(
    staged.map(({ r, status, match }) => ({
      org_id: orgId, import_id: imp.id, row_no: r.rowNo, tx_date: r.date, account_label: r.account, category: r.category,
      subcategory: r.subcategory, note: r.note, amount: r.amount, kind: r.kind, match_status: status, matched_transaction_id: match,
      // Small personal spending is pre-set to «προσωπικά»; larger amounts wait for a choice (could be a project).
      decision: status === "new" ? (r.kind === "expense" && r.amount < 300 ? "personal" : null) : "skip",
      raw: r.raw,
    })),
  );
  if (rowsError) throw new Error(rowsError.message);
  return { importId: imp.id as string, rows: rows.length, fresh, exists: staged.filter((s) => s.status === "exists").length, already: false };
}
