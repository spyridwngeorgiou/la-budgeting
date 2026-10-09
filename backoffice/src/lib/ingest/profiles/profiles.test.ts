import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";
import { parseBankFile, readBankGrid, UnsupportedFileError } from "../adapters/bankFile";
import { parseCsv } from "../csv";
import { BUILTIN_PROFILES } from "./presets";
import { detectProfile, guessColumnMap, guessHeaderRow } from "./detect";
import { applyProfile, resolveColumns, ProfileMismatchError } from "./apply";
import type { BankProfile } from "./types";

// Fixtures in ../__fixtures__ are synthetic statements shaped like the
// Greek e-banking exports (preamble lines, footer totals, windows-1253,
// debit/credit columns, a Χ/Π sign column, trailing minus, newest-first
// XLSX). Every name, ΑΦΜ, IBAN and amount is invented.
const FIXTURES = path.join(import.meta.dirname, "..", "__fixtures__");
const load = (name: string) => ({
  name,
  mimeType: "",
  bytes: new Uint8Array(readFileSync(path.join(FIXTURES, name))),
});
const ctx = { orgId: "org-1", accountId: "acc-1" };
const preset = (code: string) => BUILTIN_PROFILES.find((p) => p.bankCode === code)!;

describe("Piraeus-like CSV (windows-1253, debit/credit, preamble + totals)", () => {
  it("decodes, detects the layout below the preamble and parses every movement", async () => {
    const result = await parseBankFile(load("piraeus_1253.csv"), BUILTIN_PROFILES, ctx);
    expect(result.encoding).toBe("windows-1253");
    expect(result.profile?.bankCode).toBe("piraeus");
    expect(result.headerRow).toBe(4);
    const rows = result.batch.rows;
    expect(rows).toHaveLength(5);
    expect(rows.map((r) => [r.txDate, r.direction, r.amount])).toEqual([
      ["2026-03-02", "expense", 1240],
      ["2026-03-03", "income", 2500],
      ["2026-03-05", "expense", 86.45],
      ["2026-03-05", "expense", 2],
      ["2026-03-05", "expense", 2],
    ]);
    expect(rows[1].valueDate).toBe("2026-03-04");
    expect(rows[1].description).toBe("Κατάθεση από Παπαδόπουλος Γεώργιος ΑΦΜ 800123456");
    expect(rows[1].counterpartyAfm).toBe("800123456");
    expect(rows[2].reference).toBe("RF18539007547034");
    expect(rows.every((r) => r.parseErrors.length === 0)).toBe(true);
  });

  it("skips the totals footer and checks the running balance", async () => {
    const { batch } = await parseBankFile(load("piraeus_1253.csv"), BUILTIN_PROFILES, ctx);
    expect(batch.statement).toMatchObject({
      periodStart: "2026-03-02",
      periodEnd: "2026-03-05",
      openingBalance: 10000,
      closingBalance: 11169.55,
      balanceConsistent: true,
      order: "asc",
    });
  });

  it("gives identical-looking fees distinct keys (their balances differ)", async () => {
    const { batch } = await parseBankFile(load("piraeus_1253.csv"), BUILTIN_PROFILES, ctx);
    const keys = batch.rows.map((r) => r.externalKey);
    expect(new Set(keys).size).toBe(5);
    expect(keys.every((k) => k?.startsWith("bank:acc-1:"))).toBe(true);
  });

  it("flags an unverified preset", async () => {
    const { batch } = await parseBankFile(load("piraeus_1253.csv"), BUILTIN_PROFILES, ctx);
    expect(batch.warnings.some((w) => w.includes("δεν έχει επιβεβαιωθεί"))).toBe(true);
  });
});

describe("NBG-like CSV (UTF-8 BOM, Χ/Π sign column, quoted multi-line description)", () => {
  it("reads the sign from the marker column and the IBAN out of the description", async () => {
    const result = await parseBankFile(load("nbg_utf8_bom.csv"), BUILTIN_PROFILES, ctx);
    expect(result.encoding).toBe("utf-8");
    expect(result.profile?.bankCode).toBe("nbg");
    const [incoming, card] = result.batch.rows;
    expect(incoming).toMatchObject({ direction: "income", amount: 3100, reference: "NBG0001" });
    expect(incoming.description).toContain("\nΑΠΟ: ΞΕΝΟΔΟΧΕΙΑΚΗ ΙΚΕ");
    expect(incoming.counterpartyIban).toBe("GR5102600000000000123456789");
    expect(card).toMatchObject({ direction: "expense", amount: 45.2, description: 'ΑΓΟΡΑ ΚΑΡΤΑΣ "ΒΕΝΖΙΝΑΔΙΚΟ"' });
    expect(result.batch.statement).toMatchObject({ openingBalance: 10000, closingBalance: 13054.8, balanceConsistent: true });
  });

  it("prefers the bank's own layout over the shorter generic signature", () => {
    const grid = parseCsv("Ημερομηνία;Περιγραφή;Ποσό;Πρόσημο ποσού\n01/03/2026;x;1,00;Π");
    expect(detectProfile(grid, BUILTIN_PROFILES)?.profile.bankCode).toBe("nbg");
  });
});

describe("Alpha-like CSV (trailing minus, parentheses, no balance column)", () => {
  it("parses negatives in both notations and numbers identical lines", async () => {
    const result = await parseBankFile(load("alpha_trailing_minus_1253.csv"), BUILTIN_PROFILES, ctx);
    expect(result.profile?.bankCode).toBe("alpha");
    const rows = result.batch.rows;
    expect(rows.map((r) => [r.direction, r.amount])).toEqual([
      ["income", 0.35],
      ["expense", 2],
      ["expense", 2],
      ["expense", 1500],
    ]);
    expect(rows[2].externalKey).toBe(`${rows[1].externalKey}#2`);
    expect(result.batch.statement?.balanceConsistent).toBeNull();
  });

  it("produces the same keys when the same lines come again in an overlapping export", async () => {
    const a = await parseBankFile(load("alpha_trailing_minus_1253.csv"), BUILTIN_PROFILES, ctx);
    const b = await parseBankFile(load("alpha_trailing_minus_1253.csv"), BUILTIN_PROFILES, ctx);
    expect(b.batch.rows.map((r) => r.externalKey)).toEqual(a.batch.rows.map((r) => r.externalKey));
  });
});

describe("Eurobank-like XLSX (Date cells, signed numbers, newest first)", () => {
  it("reads typed cells, detects newest-first order and derives opening/closing", async () => {
    const result = await parseBankFile(load("eurobank.xlsx"), BUILTIN_PROFILES, ctx);
    expect(result.fileKind).toBe("xlsx");
    expect(result.profile?.bankCode).toBe("eurobank");
    expect(result.batch.rows.map((r) => [r.txDate, r.direction, r.amount])).toEqual([
      ["2026-03-20", "expense", 1860],
      ["2026-03-18", "expense", 60],
      ["2026-03-15", "income", 1000],
    ]);
    expect(result.batch.rows[1].valueDate).toBe("2026-03-19");
    expect(result.batch.statement).toMatchObject({
      order: "desc",
      openingBalance: 9000,
      closingBalance: 8080,
      balanceConsistent: true,
      periodStart: "2026-03-15",
      periodEnd: "2026-03-20",
    });
  });
});

describe("unknown layout -> mapping wizard", () => {
  it("is not forced into a preset", async () => {
    const result = await parseBankFile(load("unknown_layout.csv"), BUILTIN_PROFILES, ctx);
    expect(result.needsMapping).toBe(true);
    expect(result.batch.rows).toEqual([]);
  });

  it("guesses the header row and the columns, and the saved profile then parses", async () => {
    const { grid } = await readBankGrid(load("unknown_layout.csv"));
    const headerRow = guessHeaderRow(grid);
    expect(headerRow).toBe(2);
    const columnMap = guessColumnMap(grid[headerRow!]);
    expect(columnMap).toEqual({ date: 0, description: 1, debit: 2, credit: 3, balance: 4 });

    const custom: BankProfile = {
      ...preset("generic"),
      orgId: "org-1",
      bankCode: "custom",
      name: "Η τράπεζά μου",
      headerSignature: ["DATE", "DETAILS", "DEBIT", "CREDIT"],
      columnMap,
      dateFormat: "yyyy-MM-dd",
      decimalSeparator: ".",
      signMode: "debit_credit",
    };
    const parsed = applyProfile(grid, custom, headerRow!, { accountId: "acc-1" });
    expect(parsed.rows.map((r) => [r.direction, r.amount, r.description])).toEqual([
      ["expense", 12.5, "CARD PAYMENT, KIOSK"],
      ["income", 2000, "SALARY TRANSFER"],
    ]);
    expect(parsed.statement.balanceConsistent).toBe(true);
    // Once saved for the org, the same file is recognised automatically.
    expect(detectProfile(grid, [...BUILTIN_PROFILES, custom])?.profile.name).toBe("Η τράπεζά μου");
  });
});

describe("apply edge cases", () => {
  const profile = preset("piraeus");

  it("never lets a looser header steal an exact one", () => {
    const cols = resolveColumns(["Ημερομηνία Αξίας", "Ημερομηνία", "Περιγραφή", "Χρέωση", "Πίστωση"], profile);
    expect(cols).toMatchObject({ date: 1, value_date: 0, description: 2, debit: 3, credit: 4 });
  });

  it("refuses a layout missing required columns", () => {
    const grid = parseCsv("Ημερομηνία;Περιγραφή\n01/03/2026;x", { delimiter: ";" });
    expect(() => applyProfile(grid, profile, 0, { accountId: null })).toThrow(ProfileMismatchError);
  });

  it("keeps bad lines with errors instead of dropping them, and glues wrapped descriptions", () => {
    const grid = parseCsv(
      [
        "Ημερομηνία;Περιγραφή;Χρέωση;Πίστωση",
        "32/03/2026;ΚΑΚΗ ΗΜΕΡΟΜΗΝΙΑ;1,00;",
        "02/03/2026;ΔΙΠΛΗ;1,00;2,00",
        "03/03/2026;ΕΜΒΑΣΜΑ ΠΡΟΣ;5,00;",
        ";ΤΕΧΝΙΚΗ ΙΚΕ ΤΔΑ/129;;",
      ].join("\n"),
      { delimiter: ";" },
    );
    const { rows } = applyProfile(grid, profile, 0, { accountId: null });
    expect(rows).toHaveLength(3);
    expect(rows[0].parseErrors[0]).toContain("ημερομηνία");
    expect(rows[1].parseErrors).toContain("Η γραμμή έχει και χρέωση και πίστωση.");
    expect(rows[2].description).toBe("ΕΜΒΑΣΜΑ ΠΡΟΣ ΤΕΧΝΙΚΗ ΙΚΕ ΤΔΑ/129");
    expect(rows.every((r) => r.externalKey === null)).toBe(true);
  });

  it("rejects legacy binary .xls with an actionable message", async () => {
    const xls = { name: "kiniseis.xls", mimeType: "", bytes: new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]) };
    await expect(readBankGrid(xls)).rejects.toThrow(UnsupportedFileError);
  });
});
