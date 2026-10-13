// myDATA REST API (ΑΑΔΕ) -- read-only. Fetches the invoices we received
// (RequestDocs) and the ones we issued (RequestTransmittedDocs) and turns
// them into the same AadeParsedRow the Excel upload produces, so they go
// through the existing stage -> review -> commit flow and its dedup (ΜΑΡΚ
// first, then fingerprint). Nothing is ever sent to ΑΑΔΕ.
//
// The XML is flat and stable (AADE schema v1.x): one <invoice> per document,
// amounts in <invoiceSummary>. It is read with plain tag lookups rather than
// a full XML library; anything unexpected lands in parseErrors and the raw
// fields are kept, so nothing is dropped silently.

import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AadeParsedRow } from "./parse";
import { stageBatch } from "./dedup";

const BASE = "https://mydatapi.aade.gr/myDATA";

export type MydataCredentials = { userId: string; subscriptionKey: string };

export function mydataCredentials(): MydataCredentials | null {
  const userId = process.env.MYDATA_USER_ID;
  const subscriptionKey = process.env.MYDATA_SUBSCRIPTION_KEY;
  return userId && subscriptionKey ? { userId, subscriptionKey } : null;
}

// Names of the common document types (invoiceType), for the review screen.
const DOC_TYPE: Record<string, string> = {
  "1.1": "Τιμολόγιο Πώλησης", "1.2": "Τιμολόγιο Πώλησης / Ενδοκοινοτικές", "2.1": "Τιμολόγιο Παροχής Υπηρεσιών",
  "2.2": "Τιμολόγιο Παροχής / Ενδοκοινοτική", "5.1": "Πιστωτικό Τιμολόγιο / Συσχετιζόμενο", "5.2": "Πιστωτικό Τιμολόγιο / Μη Συσχετιζόμενο",
  "11.1": "ΑΛΠ", "11.2": "ΑΠΥ", "11.4": "Πιστωτικό Στοιχείο Λιανικής", "13.1": "Έξοδα - Αγορές Λιανικών Συναλλαγών",
  "13.30": "Παραστατικά Οντότητας (αναλυτικά)", "14.1": "Τιμολόγιο / Ενδοκοινοτικές Αποκτήσεις", "14.30": "Παραστατικά Οντότητας",
  "17.1": "Μισθοδοσία", "17.3": "Αποσβέσεις",
};

const tag = (xml: string, name: string): string | null => {
  const m = xml.match(new RegExp(`<${name}>([^<]*)</${name}>`));
  return m ? m[1].trim() : null;
};
const block = (xml: string, name: string): string => xml.split(`<${name}>`)[1]?.split(`</${name}>`)[0] ?? "";
const num = (v: string | null) => (v == null || v === "" ? null : Math.round(Number(v) * 100) / 100);
const ddmmyyyy = (d: Date) => `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`;

async function fetchAll(endpoint: "RequestDocs" | "RequestTransmittedDocs", from: Date, to: Date, creds: MydataCredentials) {
  const invoices: string[] = [];
  let pk: string | null = null;
  let rk: string | null = null;
  for (let page = 0; page < 100; page++) {
    const params = new URLSearchParams({ mark: "0", dateFrom: ddmmyyyy(from), dateTo: ddmmyyyy(to) });
    if (pk && rk) {
      params.set("nextPartitionKey", pk);
      params.set("nextRowKey", rk);
    }
    const res = await fetch(`${BASE}/${endpoint}?${params}`, {
      headers: { "aade-user-id": creds.userId, "ocp-apim-subscription-key": creds.subscriptionKey },
    });
    const xml = await res.text();
    if (!res.ok) throw new Error(`myDATA ${endpoint}: HTTP ${res.status}`);
    invoices.push(...xml.split("<invoice>").slice(1).map((x) => x.split("</invoice>")[0]));
    pk = tag(xml, "nextPartitionKey");
    rk = tag(xml, "nextRowKey");
    if (!pk) break;
  }
  return invoices;
}

function toRow(xml: string, rowNo: number, source: string): AadeParsedRow {
  const header = block(xml, "invoiceHeader");
  const summary = block(xml, "invoiceSummary");
  const issuer = block(xml, "issuer");
  const counterpart = block(xml, "counterpart");
  const type = tag(header, "invoiceType");
  const series = tag(header, "series");
  const aa = tag(header, "aa");
  const errors: string[] = [];
  const mark = tag(xml, "mark");
  const issueDate = tag(header, "issueDate");
  const gross = num(tag(summary, "totalGrossValue"));
  if (!mark) errors.push("χωρίς ΜΑΡΚ");
  if (!issueDate) errors.push("χωρίς ημερομηνία");
  if (gross == null) errors.push("χωρίς συνολικό ποσό");
  const raw = {
    source, mark, uid: tag(xml, "uid"), invoiceType: type, series, aa, issueDate,
    issuerAfm: tag(issuer, "vatNumber"), counterpartAfm: tag(counterpart, "vatNumber"),
    totalNetValue: tag(summary, "totalNetValue"), totalVatAmount: tag(summary, "totalVatAmount"),
    totalWithheldAmount: tag(summary, "totalWithheldAmount"), totalFeesAmount: tag(summary, "totalFeesAmount"),
    totalStampDutyAmount: tag(summary, "totalStampDutyAmount"), totalOtherTaxesAmount: tag(summary, "totalOtherTaxesAmount"),
    totalDeductionsAmount: tag(summary, "totalDeductionsAmount"), totalGrossValue: tag(summary, "totalGrossValue"),
    downloadingInvoiceUrl: tag(xml, "downloadingInvoiceUrl"),
  };
  return {
    rowNo,
    raw,
    issueDate,
    mydataMark: mark,
    invoiceNumber: [series, aa].filter(Boolean).join(" ") || null,
    documentType: type ? `${DOC_TYPE[type] ?? "Παραστατικό"} (${type})` : null,
    issuerAfm: raw.issuerAfm,
    receiverAfm: raw.counterpartAfm,
    counterpartyName: null,
    kadCode: null,
    kadDescription: null,
    netAmount: num(raw.totalNetValue),
    grossAmount: gross,
    vatAmount: num(raw.totalVatAmount),
    withholdingAmount: num(raw.totalWithheldAmount),
    digitalFee: null,
    fees: num(raw.totalFeesAmount),
    otherTaxes: num(raw.totalOtherTaxesAmount),
    deductions: num(raw.totalDeductionsAmount),
    discrepancy: null,
    parseErrors: errors,
  };
}

// Fetch the last `days` days from myDATA and stage only what is not already
// known (by ΜΑΡΚ, in the ledger or in an earlier batch). Returns the new
// batch id, or null when there was nothing new.
export async function syncMydata(
  supabase: SupabaseClient,
  org: { id: string; own_afm: string },
  creds: MydataCredentials,
  opts: { days?: number; userId?: string | null } = {},
): Promise<{ batchId: string | null; fetched: number; fresh: number }> {
  const to = new Date();
  const from = new Date(to.getTime() - (opts.days ?? 45) * 86400000);
  const [received, issued] = await Promise.all([
    fetchAll("RequestDocs", from, to, creds),
    fetchAll("RequestTransmittedDocs", from, to, creds),
  ]);
  const byMark = new Map<string, AadeParsedRow>();
  [...received.map((x) => ["received", x] as const), ...issued.map((x) => ["issued", x] as const)].forEach(([source, x], i) => {
    const row = toRow(x, i + 1, source);
    byMark.set(row.mydataMark ?? `nomark-${i}`, row);
  });
  const rows = [...byMark.values()];
  const marks = rows.map((r) => r.mydataMark).filter((m): m is string => !!m);

  // Already known: on a ledger row, or staged in an earlier batch.
  const [{ data: inLedger }, { data: inStaging }] = await Promise.all([
    supabase.from("transactions").select("mydata_mark").eq("org_id", org.id).in("mydata_mark", marks.length ? marks : ["-"]),
    supabase.from("aade_staging_rows").select("mydata_mark").eq("org_id", org.id).in("mydata_mark", marks.length ? marks : ["-"]),
  ]);
  const known = new Set([...(inLedger ?? []), ...(inStaging ?? [])].map((r) => r.mydata_mark));
  const fresh = rows.filter((r) => !r.mydataMark || !known.has(r.mydataMark)).map((r, i) => ({ ...r, rowNo: i + 1 }));
  if (!fresh.length) return { batchId: null, fetched: rows.length, fresh: 0 };

  // Counterparty names from our contacts (the API sends only the ΑΦΜ).
  const afms = [...new Set(fresh.map((r) => (r.issuerAfm === org.own_afm ? r.receiverAfm : r.issuerAfm)).filter((a): a is string => !!a))];
  const { data: contacts } = await supabase.from("contacts").select("afm, name").eq("org_id", org.id).in("afm", afms.length ? afms : ["-"]);
  const nameOf = new Map((contacts ?? []).map((c) => [c.afm, c.name]));
  for (const r of fresh) r.counterpartyName = nameOf.get((r.issuerAfm === org.own_afm ? r.receiverAfm : r.issuerAfm) ?? "") ?? null;

  const sha = createHash("sha256").update(fresh.map((r) => r.mydataMark).sort().join(",")).digest("hex");
  const today = to.toISOString().slice(0, 10);
  const { data: batch, error: batchError } = await supabase
    .from("aade_import_batches")
    .insert({ org_id: org.id, filename: `myDATA αυτόματη λήψη ${today}`, file_sha256: sha, period: today.slice(0, 7), row_count: fresh.length, status: "draft", uploaded_by: opts.userId ?? null })
    .select("id")
    .single();
  if (batchError) throw new Error(batchError.message);

  const staged = await stageBatch(supabase, org.id, org.own_afm, fresh);
  const { error: rowsError } = await supabase.from("aade_staging_rows").insert(
    staged.map((row) => ({
      org_id: org.id, batch_id: batch.id, row_no: row.rowNo, raw: row.raw, issue_date: row.issueDate, mydata_mark: row.mydataMark,
      invoice_number: row.invoiceNumber, document_type: row.documentType, issuer_afm: row.issuerAfm, receiver_afm: row.receiverAfm,
      counterparty_afm: row.counterpartyAfm, counterparty_name: row.counterpartyName, net_amount: row.netAmount, gross_amount: row.grossAmount,
      vat_amount: row.vatAmount, withholding_amount: row.withholdingAmount, fees: row.fees, other_taxes: row.otherTaxes, deductions: row.deductions,
      direction: row.direction, fingerprint: row.fingerprint, dedup_status: row.dedupStatus, matched_transaction_id: row.matchedTransactionId,
      decision: (row.dedupStatus === "new" ? "import" : "skip") as "import" | "skip", parse_errors: row.parseErrors,
    })),
  );
  if (rowsError) throw new Error(rowsError.message);
  const newCount = staged.filter((r) => r.dedupStatus === "new").length;
  await supabase.from("aade_import_batches").update({ new_count: newCount, dup_count: staged.length - newCount }).eq("id", batch.id);
  return { batchId: batch.id, fetched: rows.length, fresh: fresh.length };
}
