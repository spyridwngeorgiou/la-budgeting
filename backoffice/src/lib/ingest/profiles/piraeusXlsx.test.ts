import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { parseBankFile } from "../adapters/bankFile";
import { isValidIban } from "../text";
import { applyProfile, cleanCellText, resolveColumnSets, uniqueHeaderNames } from "./apply";
import { matchStatementAccount, parseHeaderLines, readStatementHeader } from "./header";
import { BUILTIN_PROFILES } from "./presets";
import type { Grid } from "./types";

// A synthetic workbook laid out like the Piraeus e-banking export: bank
// name in A1, IBAN in A4, period in A5, header in row 7, signed amounts,
// newest first, multi-line «Σχόλια» (OOXML `_x000D_` + \n), a repeated
// «Νόμισμα» header and the «Ημερομηνία Ενημέρωσης» stamp under the table.
// Every name, number and amount is invented.

// A checksum-valid Greek IBAN for an invented account.
function greekIban(bank: string, account: string): string {
  const bban = `${bank}${account}`.padEnd(23, "0");
  const numeric = `${bban}GR00`.replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  let rem = 0;
  for (const d of numeric) rem = (rem * 10 + Number(d)) % 97;
  return `GR${String(98 - rem).padStart(2, "0")}${bban}`;
}
const IBAN = greekIban("0170000", "0000012345678901");
const spaced = IBAN.replace(/(.{4})/g, "$1 ").trim();

const HEADER = [
  "Κατηγορία",
  "Περιγραφή Συναλλαγής",
  "Ημ/νία Συναλλαγής",
  "Σχόλια / Κωδικός Αναφοράς",
  "Ποσό",
  "Νόμισμα",
  "Προοδευτικό Λογιστικό Υπόλοιπο",
  "Νόμισμα",
];

// Newest first: balance after each line; oldest line's opening is 1.000,00.
const MOVEMENTS: (string | number)[][] = [
  ["Χρέωση", "ΠΛΗΡΩΜΗ ΛΟΓΑΡΙΑΣΜΟΥ      ", "05/03/2026", "ΛΟΓΑΡΙΑΣΜΟΣ ΡΕΥΜΑΤΟΣ_x000D_\n12,40 EUR_x000D_\nΑΡ. ΠΑΡΟΧΗΣ 11112222333 / TX0000000000000003", -12.4, "EUR", 1437.6, "EUR"],
  ["Πίστωση", "ΜΕΤΑΦΟΡΑ ΑΠΟ ΛΟΓΑΡΙΑΣΜΟ", "04/03/2026", "ΜΙΣΘΩΜΑ ΜΑΡΤΙΟΥ_x000D_\n500,00 EUR / TX0000000000000002", 500, "EUR", 1450, "EUR"],
  ["Χρέωση", "ΑΓΟΡΑ ΜΕ ΚΑΡΤΑ", "02/03/2026", "ΠΡΑΤΗΡΙΟ ΚΑΥΣΙΜΩΝ_x000D_\n50,00 EUR / TX0000000000000001", -50, "EUR", 950, "EUR"],
];

async function workbook(movements = MOVEMENTS): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Κινήσεις Λογαριασμών");
  ws.getCell("A1").value = "Τράπεζα Πειραιώς";
  ws.getCell("A2").value = "Κινήσεις Λογαριασμών";
  ws.getCell("A4").value = `ΒΑΣΙΚΟ ΤΑΜΙΕΥΤΗΡΙΟ Κ:  ${spaced}`;
  ws.getCell("A5").value = "Επιλεγμένη Περίοδος: 01/03/2026 - 31/03/2026";
  ws.getRow(7).values = HEADER;
  movements.forEach((m, i) => {
    ws.getRow(8 + i).values = m;
  });
  const footerRow = 8 + movements.length + 2;
  ws.getCell(`A${footerRow}`).value = "Ημερομηνία Ενημέρωσης:";
  ws.getCell(`B${footerRow}`).value = "12/03/2026 10:15:00";
  return new Uint8Array(await wb.xlsx.writeBuffer());
}

const file = async (movements?: (string | number)[][]) => ({ name: "kiniseis.xlsx", mimeType: "", bytes: await workbook(movements) });
const ctx = { orgId: "org-1", accountId: "acc-1" };
const piraeusXlsx = BUILTIN_PROFILES.find((p) => p.name === "Πειραιώς (XLSX, e-banking)")!;

describe("Piraeus e-banking XLSX", () => {
  it("is a valid synthetic IBAN", () => {
    expect(isValidIban(IBAN)).toBe(true);
  });

  it("is detected by its row-7 header and every movement is read", async () => {
    const result = await parseBankFile(await file(), BUILTIN_PROFILES, ctx);
    expect(result.profile?.name).toBe("Πειραιώς (XLSX, e-banking)");
    expect(result.headerRow).toBe(6);
    expect(result.batch.rows.map((r) => [r.txDate, r.direction, r.amount, r.balanceAfter])).toEqual([
      ["2026-03-05", "expense", 12.4, 1437.6],
      ["2026-03-04", "income", 500, 1450],
      ["2026-03-02", "expense", 50, 950],
    ]);
    expect(result.batch.rows.every((r) => r.parseErrors.length === 0)).toBe(true);
    // Built from a real export: no "unverified layout" warning.
    expect(result.batch.warnings).toEqual([]);
  });

  it("joins «Περιγραφή» and the multi-line «Σχόλια» into one description", async () => {
    const { batch } = await parseBankFile(await file(), BUILTIN_PROFILES, ctx);
    expect(batch.rows[1].description).toBe("ΜΕΤΑΦΟΡΑ ΑΠΟ ΛΟΓΑΡΙΑΣΜΟ · ΜΙΣΘΩΜΑ ΜΑΡΤΙΟΥ · 500,00 EUR / TX0000000000000002");
    expect(batch.rows[0].description).not.toMatch(/_x000D_|\r|\n/);
  });

  it("never glues the «Ημερομηνία Ενημέρωσης» stamp onto the last movement", async () => {
    const result = await parseBankFile(await file(), BUILTIN_PROFILES, ctx);
    const last = result.batch.rows.at(-1)!;
    expect(last.description).toBe("ΑΓΟΡΑ ΜΕ ΚΑΡΤΑ · ΠΡΑΤΗΡΙΟ ΚΑΥΣΙΜΩΝ · 50,00 EUR / TX0000000000000001");
    expect(result.batch.rows).toHaveLength(3);
  });

  it("keeps both «Νόμισμα» columns in raw, told apart by position", async () => {
    const { batch } = await parseBankFile(await file(), BUILTIN_PROFILES, ctx);
    expect(Object.keys(batch.rows[0].raw)).toContain("Νόμισμα (2)");
  });

  it("reads IBAN and period from the header area; the period goes to the statement", async () => {
    const result = await parseBankFile(await file(), BUILTIN_PROFILES, ctx);
    expect(result.header).toMatchObject({ iban: IBAN, periodStart: "2026-03-01", periodEnd: "2026-03-31" });
    expect(result.batch.statement).toMatchObject({
      periodStart: "2026-03-01",
      periodEnd: "2026-03-31",
      openingBalance: 1000,
      closingBalance: 1437.6,
      balanceConsistent: true,
      order: "desc",
    });
  });

  it("flags a running balance that does not add up", async () => {
    const broken = MOVEMENTS.map((m) => [...m]);
    broken[1][6] = 1460; // misread balance on the middle line
    const { batch } = await parseBankFile(await file(broken), BUILTIN_PROFILES, ctx);
    expect(batch.statement?.balanceConsistent).toBe(false);
    expect(batch.statement?.balanceMismatchRows.length).toBeGreaterThan(0);
  });

  it("picks the account by IBAN when none was chosen, and keys the lines to it", async () => {
    const accounts = [
      { id: "acc-other", name: "Άλλη", iban: greekIban("0110000", "0000099999999999"), account_number: null },
      { id: "acc-p", name: "Πειραιώς", iban: spaced, account_number: null },
    ];
    const result = await parseBankFile(await file(), BUILTIN_PROFILES, { orgId: "org-1", accountId: null }, { accounts });
    expect(result.accountId).toBe("acc-p");
    expect(result.batch.rows.every((r) => r.externalKey?.startsWith("bank:acc-p:"))).toBe(true);
  });

  it("warns when the chosen account is not the one the IBAN names", async () => {
    const accounts = [
      { id: "acc-1", name: "Ταμείο", iban: null, account_number: null },
      { id: "acc-p", name: "Πειραιώς", iban: IBAN, account_number: null },
    ];
    const result = await parseBankFile(await file(), BUILTIN_PROFILES, ctx, { accounts });
    expect(result.accountId).toBe("acc-1");
    expect(result.batch.warnings.some((w) => w.includes("Πειραιώς"))).toBe(true);
  });
});

describe("header & account helpers", () => {
  it("reads an Optima-style header: account number, available balance, dated period", () => {
    const h = parseHeaderLines([
      "Ιστορικό συναλλαγών λογαριασμού",
      "Αριθμός λογαριασμού: 12345678901234",
      "Διαθέσιμο υπόλοιπο: EUR 12.345,67",
      "Περίοδος: 01/01/2026 - 30/06/2026",
    ]);
    expect(h).toEqual({
      iban: null,
      accountNumber: "12345678901234",
      periodStart: "2026-01-01",
      periodEnd: "2026-06-30",
      availableBalance: 12345.67,
    });
  });

  it("leaves a relative period («Τελευταίοι 6 μήνες») to the movement dates", () => {
    expect(parseHeaderLines(["Περίοδος: Τελευταίοι 6 μήνες"]).periodStart).toBeNull();
  });

  it("matches by stored account number or by the IBAN's account-number tail", () => {
    const accounts = [
      { id: "a", name: "A", iban: null, account_number: "12345678901234" },
      { id: "b", name: "B", iban: greekIban("0590000", "0098765432109876"), account_number: null },
    ];
    expect(matchStatementAccount(accounts, { iban: null, accountNumber: "12345678901234" })?.id).toBe("a");
    expect(matchStatementAccount(accounts, { iban: null, accountNumber: "98765432109876" })?.id).toBe("b");
    expect(matchStatementAccount(accounts, { iban: null, accountNumber: "55555555555555" })).toBeNull();
    // Ambiguous -> no guess.
    expect(matchStatementAccount([...accounts, { id: "c", name: "C", iban: null, account_number: "12345678901234" }], { iban: null, accountNumber: "12345678901234" })).toBeNull();
  });

  it("reads the header only above the table", () => {
    const grid: Grid = [["Τράπεζα"], [`IBAN: ${IBAN}`], ["Ημερομηνία", "Ποσό"], ["Περίοδος: 01/02/2026 - 28/02/2026"]];
    expect(readStatementHeader(grid, 2)).toMatchObject({ iban: IBAN, periodStart: null });
  });

  it("normalises _x000D_ and line breaks to « · »", () => {
    expect(cleanCellText("ΕΝΑ_x000D_\nΔΥΟ\r\n  ΤΡΙΑ  ")).toBe("ΕΝΑ · ΔΥΟ · ΤΡΙΑ");
    expect(cleanCellText("  ΑΠΛΟ  ")).toBe("ΑΠΛΟ");
  });

  it("resolves a joined field to several columns and disambiguates repeated headers", () => {
    const sets = resolveColumnSets(HEADER, piraeusXlsx);
    expect(sets.description).toEqual([1, 3]);
    expect(sets.amount).toEqual([4]);
    expect(uniqueHeaderNames(HEADER).filter((n) => n.startsWith("Νόμισμα"))).toEqual(["Νόμισμα", "Νόμισμα (2)"]);
  });

  it("a joined part missing from the file is simply left out", () => {
    const grid: Grid = [
      ["Ημ/νία Συναλλαγής", "Περιγραφή Συναλλαγής", "Ποσό", "Προοδευτικό Λογιστικό Υπόλοιπο"],
      ["01/03/2026", "ΚΑΤΑΘΕΣΗ", 10, 110],
    ];
    const { rows } = applyProfile(grid, piraeusXlsx, 0, { accountId: null });
    expect(rows[0].description).toBe("ΚΑΤΑΘΕΣΗ");
  });
});
