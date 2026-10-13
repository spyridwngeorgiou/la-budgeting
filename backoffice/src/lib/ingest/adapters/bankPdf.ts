import { toCents } from "@/lib/finance/money";
import { isIsoDate } from "@/lib/dates";
import type { BankStatementExtraction } from "@/lib/ai/bankStatementRequest";
import { bankLineKeys } from "../fingerprint";
import { cleanCellText, summarizeStatement } from "../profiles/apply";
import { EMPTY_HEADER, matchStatementAccount, parseHeaderLines, type AccountIdentity, type StatementHeader } from "../profiles/header";
import { extractRefs, isValidIban, normalizeGreek, parseDate, parseGreekNumber } from "../text";
import type { AdapterContext, CanonicalRow, IngestAdapter, ParsedBatch, UploadedFile } from "../types";
import { sniffFileKind } from "../xlsx";

// PDF bank statement (Optima «Ιστορικό συναλλαγών λογαριασμού» and alike)
// -> canonical movements. A Worker cannot run a PDF table extractor, so the
// text is read by the AI extraction stack (lib/ai/bankStatement.ts, injected
// here so this half stays pure and testable). What the model returns is
// never trusted as-is:
//   - every amount/balance is re-parsed from the literal text it read;
//   - the running balance must agree on every line (summarizeStatement) --
//     if it does not, the batch is flagged «χρειάζεται έλεγχο» and nothing
//     is pre-accepted;
//   - bank fee lines («ΕΞΟΔΑ ΜΕΤΑΦΟΡΑΣ») stay separate movements, hinted to
//     «Τραπεζικά» and tied to their transfer by the shared transaction code.

export type BankStatementExtractor = (base64Pdf: string) => Promise<{
  extraction: BankStatementExtraction;
  usage: { model: string; inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number; requestId: string };
}>;

export const FEE_CATEGORY_HINT = "Τραπεζικά";
const FEE_RE = /^(ΕΞΟΔΑ (ΜΕΤΑΦΟΡΑΣ|ΕΜΒΑΣΜΑΤΟΣ|ΣΥΝΑΛΛΑΓΗΣ|ΤΗΡΗΣΗΣ)|ΠΡΟΜΗΘΕΙΑ|ΧΡΕΩΣΗ ΠΡΟΜΗΘΕΙΑΣ)/;

export function isFeeLine(description: string | null | undefined): boolean {
  return FEE_RE.test(normalizeGreek(description));
}

function isoDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const v = value.trim();
  if (isIsoDate(v)) return v;
  return parseDate(v, "dd/MM/yyyy");
}

// The number the model read, re-parsed from its own evidence text; when the
// two disagree, the text wins and the line says so.
function money(value: number | null, text: string | null | undefined): { value: number | null; mismatch: boolean } {
  const fromText = text ? parseGreekNumber(text, { decimal: "," }) : null;
  if (fromText === null) return { value, mismatch: false };
  return { value: fromText, mismatch: value !== null && toCents(value) !== toCents(fromText) };
}

export interface BankPdfMapped {
  batch: ParsedBatch;
  header: StatementHeader;
  // Why the batch must be checked by hand (empty = the statement is
  // internally consistent). Non-empty disables pre-accepted matches.
  needsReview: string[];
}

export function bankPdfToBatch(extraction: BankStatementExtraction, ctx: { accountId: string | null }): BankPdfMapped {
  const rows: CanonicalRow[] = [];
  const signed: (number | null)[] = [];

  extraction.rows.forEach((r, i) => {
    const parseErrors: string[] = [];
    const txDate = isoDate(r.date);
    if (!txDate) parseErrors.push(`Μη αναγνωρίσιμη ημερομηνία: «${r.date}»`);
    const valueDate = isoDate(r.value_date);

    const amount = money(r.amount, r.amount_text);
    if (amount.mismatch) parseErrors.push(`Το ποσό δεν συμφωνεί με το κείμενο «${r.amount_text}».`);
    let amountSigned = amount.value;
    if (amountSigned === null || amountSigned === 0) {
      parseErrors.push("Μη αναγνωρίσιμο ή μηδενικό ποσό.");
      amountSigned = null;
    }
    const balance = money(r.balance, r.balance_text);
    if (balance.mismatch) parseErrors.push(`Το υπόλοιπο δεν συμφωνεί με το κείμενο «${r.balance_text}».`);

    const head = cleanCellText(r.description ?? "");
    const details = cleanCellText(r.details ?? "");
    const description = [head, details].filter(Boolean).join(" · ") || null;
    const reference = r.code?.trim() || null;
    const counterpartyName = cleanCellText(r.counterparty_name ?? "") || null;
    const ibanText = r.counterparty_iban?.replace(/\s+/g, "").toUpperCase() || null;
    const extracted = extractRefs(description, reference, counterpartyName, ibanText);
    const fee = isFeeLine(head);

    rows.push({
      rowNo: i + 1,
      kind: "movement",
      raw: { ...r },
      extracted,
      externalKey: null,
      txDate,
      valueDate,
      direction: amountSigned === null ? null : amountSigned < 0 ? "expense" : "income",
      amount: amountSigned === null ? null : Math.abs(amountSigned),
      description,
      counterpartyName: fee ? null : counterpartyName,
      counterpartyAfm: extracted.afms[0] ?? null,
      counterpartyIban: fee ? null : ibanText && isValidIban(ibanText) ? ibanText : (extracted.ibans[0] ?? null),
      reference,
      balanceAfter: balance.value,
      parseErrors,
      categoryHint: fee ? FEE_CATEGORY_HINT : null,
      meta: fee && reference ? { fee_of: reference } : undefined,
    });
    signed.push(amountSigned);
  });

  // A fee line with no transfer sharing its code is still a fee, just untied.
  const codes = new Map<string, number>();
  for (const row of rows) if (row.reference) codes.set(row.reference, (codes.get(row.reference) ?? 0) + 1);
  for (const row of rows) {
    if (row.meta?.fee_of && (codes.get(row.reference!) ?? 0) < 2) delete row.meta.fee_of;
  }

  if (ctx.accountId) {
    const complete = rows.map((row, i) => ({ row, s: signed[i] })).filter(({ row, s }) => row.txDate && s !== null);
    const keys = bankLineKeys(
      complete.map(({ row, s }) => ({
        accountId: ctx.accountId!,
        date: row.txDate!,
        signedAmount: s!,
        description: row.description,
        reference: row.reference,
        balanceAfter: row.balanceAfter,
      })),
    );
    complete.forEach(({ row }, i) => {
      row.externalKey = keys[i];
    });
  }

  const header: StatementHeader = {
    ...EMPTY_HEADER,
    ...parseHeaderLines(extraction.period_text ? [`Περίοδος: ${extraction.period_text}`] : []),
    iban: extraction.iban?.replace(/\s+/g, "").toUpperCase() || null,
    accountNumber: extraction.account_number?.replace(/\D/g, "") || null,
    availableBalance: extraction.available_balance,
  };
  if (!header.periodStart) {
    header.periodStart = isoDate(extraction.period_start);
    header.periodEnd = isoDate(extraction.period_end);
  }

  const statement = summarizeStatement(rows, signed);
  if (header.periodStart && header.periodEnd) {
    statement.periodStart = header.periodStart;
    statement.periodEnd = header.periodEnd;
  }

  const needsReview: string[] = [];
  if (rows.length === 0) needsReview.push("Δεν διαβάστηκε καμία κίνηση από το PDF.");
  else if (statement.balanceConsistent === null) needsReview.push("Το PDF δεν έδωσε υπόλοιπο ανά κίνηση — ο έλεγχος υπολοίπου δεν έγινε.");
  else if (statement.balanceConsistent === false) {
    needsReview.push(
      `Το υπόλοιπο δεν συμφωνεί με τα ποσά σε ${statement.balanceMismatchRows.length} γραμμή/ές (${statement.balanceMismatchRows.slice(0, 10).join(", ")}) — πιθανό λάθος ανάγνωσης.`,
    );
  }
  const misread = rows.filter((r) => r.parseErrors.length > 0).length;
  if (misread > 0) needsReview.push(`${misread} γραμμή/ές με αμφίβολη ανάγνωση.`);

  const warnings = [...needsReview];
  if (!ctx.accountId) warnings.push("Δεν επιλέχθηκε λογαριασμός — η ανίχνευση διπλοεγγραφών ανάμεσα σε αρχεία είναι ανενεργή.");

  return {
    batch: { source: "bank_pdf", rows, statement, profileId: null, warnings },
    header,
    needsReview,
  };
}

export interface BankPdfResult extends BankPdfMapped {
  accountId: string | null;
  usage: Awaited<ReturnType<BankStatementExtractor>>["usage"];
}

// Read + map. The account is the caller's, else the one the statement's
// own account number / IBAN identifies among `accounts`.
export async function parseBankPdf(
  file: UploadedFile,
  ctx: AdapterContext,
  extract: BankStatementExtractor,
  accounts: AccountIdentity[] = [],
): Promise<BankPdfResult> {
  const { extraction, usage } = await extract(base64Of(file.bytes));
  const provisional = bankPdfToBatch(extraction, { accountId: null });
  const fromHeader = matchStatementAccount(accounts, provisional.header);
  const accountId = ctx.accountId ?? fromHeader?.id ?? null;
  const mapped = accountId ? bankPdfToBatch(extraction, { accountId }) : provisional;
  if (ctx.accountId && fromHeader && fromHeader.id !== ctx.accountId) {
    mapped.batch.warnings.push(`Ο αριθμός λογαριασμού του αρχείου αντιστοιχεί στον λογαριασμό «${fromHeader.name}», όχι σε αυτόν που επιλέξατε.`);
  }
  return { ...mapped, accountId, usage };
}

function base64Of(bytes: Uint8Array): string {
  if (typeof Buffer !== "undefined") return Buffer.from(bytes).toString("base64");
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function createBankPdfAdapter(extract: BankStatementExtractor): IngestAdapter {
  return {
    source: "bank_pdf",
    canHandle: (file) => sniffFileKind(file.bytes, file.name) === "pdf",
    parse: async (file, ctx) => (await parseBankPdf(file, ctx, extract)).batch,
  };
}
