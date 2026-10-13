import { describe, expect, it, vi } from "vitest";
import { bankStatementRequest, BankStatementSchema, type BankStatementExtraction } from "@/lib/ai/bankStatementRequest";
import { EXTRACTION_MODEL, REFUSAL_FALLBACK_BETA } from "@/lib/ai/models";
import { bankPdfToBatch, createBankPdfAdapter, FEE_CATEGORY_HINT, isFeeLine, parseBankPdf, type BankStatementExtractor } from "./bankPdf";

// A synthetic transcription shaped like an Optima «Ιστορικό συναλλαγών
// λογαριασμού»: newest first, a transfer and its separate «ΕΞΟΔΑ ΜΕΤΑΦΟΡΑΣ»
// line sharing one code, a counterparty «NAME - IBAN - … - BANK» in the
// second description. Every name, number and amount is invented.

const CP_IBAN = "GR1601101250000000012300695"; // the textbook-valid example IBAN

function statement(overrides: Partial<BankStatementExtraction> = {}): BankStatementExtraction {
  return {
    account_number: "12345678901234",
    iban: null,
    available_balance: 2397.5,
    period_text: "Τελευταίοι 6 μήνες",
    period_start: null,
    period_end: null,
    rows: [
      {
        date: "2026-03-05",
        value_date: "2026-03-05",
        description: "ΕΞΟΔΑ ΜΕΤΑΦΟΡΑΣ",
        code: "2026AB01CD2",
        amount: -2.5,
        amount_text: "-2,50 EUR",
        balance: 2397.5,
        balance_text: "2.397,50 EUR",
        counterparty_name: null,
        counterparty_iban: null,
        details: null,
      },
      {
        date: "2026-03-05",
        value_date: "2026-03-05",
        description: "ΜΕΤΑΦΟΡΑ ΠΡΟΣ ΑΛΛΗ ΤΡΑΠΕΖΑ",
        code: "2026AB01CD2",
        amount: -1100,
        amount_text: "-1.100,00\nEUR",
        balance: 2400,
        balance_text: "2.400,00 EUR",
        counterparty_name: "ΔΟΚΙΜΑΣΤΙΚΟΣ ΠΡΟΜΗΘΕΥΤΗΣ",
        counterparty_iban: CP_IBAN,
        details: `ΔΟΚΙΜΑΣΤΙΚΟΣ ΠΡΟΜΗΘΕΥΤΗΣ -\n${CP_IBAN}\n- ΠΛΗΡΩΜΗ - ΔΟΚΙΜΑΣΤΙΚΗ ΤΡΑΠΕΖΑ`,
      },
      {
        date: "02/03/2026",
        value_date: null,
        description: "ΚΑΤΑΘΕΣΗ",
        code: "2026AB01CD1",
        amount: 500,
        amount_text: "500,00 EUR",
        balance: 3500,
        balance_text: "3.500,00 EUR",
        counterparty_name: null,
        counterparty_iban: null,
        details: null,
      },
    ],
    ...overrides,
  };
}

describe("bankPdfToBatch (Optima-like PDF transcription -> rows)", () => {
  it("maps every row with signed amounts, value dates and counterparty", () => {
    const { batch } = bankPdfToBatch(statement(), { accountId: "acc-o" });
    expect(batch.source).toBe("bank_pdf");
    expect(batch.rows.map((r) => [r.txDate, r.direction, r.amount, r.balanceAfter, r.reference])).toEqual([
      ["2026-03-05", "expense", 2.5, 2397.5, "2026AB01CD2"],
      ["2026-03-05", "expense", 1100, 2400, "2026AB01CD2"],
      ["2026-03-02", "income", 500, 3500, "2026AB01CD1"],
    ]);
    const transfer = batch.rows[1];
    expect(transfer.counterpartyName).toBe("ΔΟΚΙΜΑΣΤΙΚΟΣ ΠΡΟΜΗΘΕΥΤΗΣ");
    expect(transfer.counterpartyIban).toBe(CP_IBAN);
    expect(transfer.valueDate).toBe("2026-03-05");
    expect(transfer.description).toBe(`ΜΕΤΑΦΟΡΑ ΠΡΟΣ ΑΛΛΗ ΤΡΑΠΕΖΑ · ΔΟΚΙΜΑΣΤΙΚΟΣ ΠΡΟΜΗΘΕΥΤΗΣ - · ${CP_IBAN} · - ΠΛΗΡΩΜΗ - ΔΟΚΙΜΑΣΤΙΚΗ ΤΡΑΠΕΖΑ`);
    expect(batch.rows.every((r) => r.parseErrors.length === 0)).toBe(true);
    expect(batch.rows.every((r) => r.externalKey?.startsWith("bank:acc-o:"))).toBe(true);
  });

  it("keeps fee lines separate, hinted «Τραπεζικά» and tied to their transfer by code", () => {
    const { batch } = bankPdfToBatch(statement(), { accountId: null });
    const [fee, transfer, deposit] = batch.rows;
    expect(fee.categoryHint).toBe(FEE_CATEGORY_HINT);
    expect(fee.meta).toEqual({ fee_of: "2026AB01CD2" });
    expect(fee.counterpartyIban).toBeNull();
    expect(transfer.categoryHint).toBeNull();
    expect(deposit.meta).toBeUndefined();
    expect(isFeeLine("Έξοδα μεταφοράς")).toBe(true);
    expect(isFeeLine("ΜΕΤΑΦΟΡΑ ΠΡΟΣ")).toBe(false);
  });

  it("an untied fee (no transfer with its code) is still a fee", () => {
    const s = statement();
    s.rows[0].code = "LONELY0001";
    const { batch } = bankPdfToBatch(s, { accountId: null });
    expect(batch.rows[0].categoryHint).toBe(FEE_CATEGORY_HINT);
    expect(batch.rows[0].meta).toEqual({});
  });

  it("passes the running-balance check on a consistent statement", () => {
    const { batch, needsReview, header } = bankPdfToBatch(statement(), { accountId: "acc-o" });
    expect(batch.statement).toMatchObject({
      balanceConsistent: true,
      order: "desc",
      openingBalance: 3000,
      closingBalance: 2397.5,
      periodStart: "2026-03-02",
      periodEnd: "2026-03-05",
    });
    expect(needsReview).toEqual([]);
    expect(header).toMatchObject({ accountNumber: "12345678901234", availableBalance: 2397.5, periodStart: null });
  });

  it("flags «χρειάζεται έλεγχο» when the running balance does not add up", () => {
    const s = statement();
    s.rows[1].balance = 2410;
    s.rows[1].balance_text = "2.410,00 EUR";
    const { batch, needsReview } = bankPdfToBatch(s, { accountId: "acc-o" });
    expect(batch.statement?.balanceConsistent).toBe(false);
    expect(needsReview.length).toBeGreaterThan(0);
    expect(batch.warnings).toEqual(expect.arrayContaining(needsReview));
  });

  it("re-parses amounts from the text it read and flags a disagreement", () => {
    const s = statement();
    s.rows[2].amount = 50; // the model's number disagrees with its own evidence
    const { batch, needsReview } = bankPdfToBatch(s, { accountId: null });
    expect(batch.rows[2].amount).toBe(500);
    expect(batch.rows[2].parseErrors[0]).toContain("500,00 EUR");
    expect(needsReview.some((r) => r.includes("αμφίβολη"))).toBe(true);
  });

  it("flags a statement with no balance column and one with no rows", () => {
    const noBalance = statement();
    noBalance.rows.forEach((r) => {
      r.balance = null;
      r.balance_text = null;
    });
    expect(bankPdfToBatch(noBalance, { accountId: null }).needsReview[0]).toContain("υπόλοιπο");
    expect(bankPdfToBatch(statement({ rows: [] }), { accountId: null }).needsReview[0]).toContain("καμία κίνηση");
  });

  it("uses a dated header period for the batch", () => {
    const { batch } = bankPdfToBatch(statement({ period_text: "01/03/2026 - 31/03/2026" }), { accountId: null });
    expect(batch.statement).toMatchObject({ periodStart: "2026-03-01", periodEnd: "2026-03-31" });
  });
});

describe("parseBankPdf (model call mocked)", () => {
  const pdf = { name: "accountTransactionHistory.pdf", mimeType: "application/pdf", bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]) };
  const usage = { model: EXTRACTION_MODEL, inputTokens: 10, outputTokens: 20, cacheReadTokens: 0, cacheWriteTokens: 0, requestId: "req_1" };

  it("sends the PDF as base64 and picks the account by its number", async () => {
    const extract = vi.fn<BankStatementExtractor>().mockResolvedValue({ extraction: statement(), usage });
    const accounts = [
      { id: "acc-x", name: "Άλλος", iban: null, account_number: null },
      { id: "acc-o", name: "Optima", iban: null, account_number: "12345678901234" },
    ];
    const result = await parseBankPdf(pdf, { orgId: "org-1", accountId: null }, extract, accounts);
    expect(extract).toHaveBeenCalledWith(Buffer.from(pdf.bytes).toString("base64"));
    expect(result.accountId).toBe("acc-o");
    expect(result.batch.rows[0].externalKey).toMatch(/^bank:acc-o:/);
    expect(result.usage.requestId).toBe("req_1");
  });

  it("keeps the chosen account but warns when the file names another", async () => {
    const extract: BankStatementExtractor = async () => ({ extraction: statement(), usage });
    const accounts = [{ id: "acc-o", name: "Optima", iban: null, account_number: "12345678901234" }];
    const result = await parseBankPdf(pdf, { orgId: "org-1", accountId: "acc-1" }, extract, accounts);
    expect(result.accountId).toBe("acc-1");
    expect(result.batch.warnings.some((w) => w.includes("Optima"))).toBe(true);
  });

  it("the adapter takes PDFs only", async () => {
    const adapter = createBankPdfAdapter(async () => ({ extraction: statement(), usage }));
    expect(adapter.source).toBe("bank_pdf");
    expect(await adapter.canHandle(pdf)).toBe(true);
    expect(await adapter.canHandle({ ...pdf, name: "a.csv", bytes: new TextEncoder().encode("a;b") })).toBe(false);
  });
});

describe("bankStatementRequest", () => {
  it("uses the extraction stack: Sonnet, structured output, refusal fallback, no forced tools", () => {
    const req = bankStatementRequest({ base64Data: "QUJD" }) as unknown as Record<string, unknown> & ReturnType<typeof bankStatementRequest>;
    expect(req.model).toBe(EXTRACTION_MODEL);
    expect(req.output_config.format.type).toBe("json_schema");
    expect(req.betas).toEqual([REFUSAL_FALLBACK_BETA]);
    expect(req).not.toHaveProperty("tool_choice");
    expect(req).not.toHaveProperty("thinking");
    expect(req.messages[0].content[0]).toMatchObject({ type: "document", source: { media_type: "application/pdf", data: "QUJD" } });
    const schema = JSON.stringify(req.output_config.format.schema);
    for (const field of ["account_number", "available_balance", "value_date", "counterparty_iban", "amount_text", "code"]) {
      expect(schema).toContain(field);
    }
  });

  it("the schema accepts a well-formed transcription and rejects a row without an amount", () => {
    expect(BankStatementSchema.safeParse(statement()).success).toBe(true);
    const bad = statement();
    (bad.rows[0] as Record<string, unknown>).amount = undefined;
    expect(BankStatementSchema.safeParse(bad).success).toBe(false);
  });
});
