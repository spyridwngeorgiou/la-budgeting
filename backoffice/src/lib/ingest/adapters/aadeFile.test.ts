import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { classifyAadeRows } from "@/lib/aade/dedup";
import { legacyAadeTransaction, toAadeStagingRow } from "@/lib/aade/commitRules";
import { PARITY_ASSIGNMENT, PARITY_OWN_AFM, PARITY_ROWS } from "@/lib/aade/__fixtures__/parity";
import { toIngestRowFields } from "../stage";
import { aadeFileMeta, aadeStagedToStageRows, NEGATIVE_AMOUNT_ERROR } from "./aadeFile";

// Side-by-side, half 1 of 2. The same AADE fixture goes through
//   old: toAadeStagingRow -> (reviewer assigns) -> legacyAadeTransaction
//        (exactly what uploadAadeFile + commitBatch run), and
//   new: aadeStagedToStageRows -> (reviewer assigns) -> toIngestRowFields
//        (exactly what the unified upload stages).
// Both outputs must equal the JSON blocks embedded in
// supabase/tests/0071_aade_commit_parity.test.sql, which then (half 2)
// writes the first set into the ledger the old way, commits the second with
// commit_ingest_batch, and diffs the two sets of transactions.
// Regenerate the blocks after a deliberate change with PRINT_PARITY=<out file>.

const SQL = path.resolve(import.meta.dirname, "../../../../supabase/tests/0071_aade_commit_parity.test.sql");

function sqlBlock(tag: string): unknown {
  const text = readFileSync(SQL, "utf8");
  const m = text.match(new RegExp(`\\$${tag}\\$([\\s\\S]*?)\\$${tag}\\$`));
  if (!m) throw new Error(`no $${tag}$ block in ${SQL}`);
  return JSON.parse(m[1]);
}

const ORG = "org";
const staged = classifyAadeRows(PARITY_ROWS, PARITY_OWN_AFM);

function legacyRows() {
  return staged
    .map((s) => ({
      ...toAadeStagingRow(s),
      id: `staging-${s.rowNo}`,
      project_id: PARITY_ASSIGNMENT.projectId,
      category_id: PARITY_ASSIGNMENT.categoryId,
      account_id: PARITY_ASSIGNMENT.accountId,
      status: "paid" as const, // aade_staging_rows.status default
      scope: "business" as const, // aade_staging_rows.scope default
    }))
    .filter((r) => r.decision === "import")
    .map((r) => {
      const tx = legacyAadeTransaction(ORG, { ...r, issue_date: r.issue_date!, direction: r.direction }, null);
      const { org_id, contact_id, aade_staging_row_id, ...rest } = tx;
      void org_id;
      void contact_id;
      void aade_staging_row_id;
      // resolveOrCreateContact's inputs, replayed by the SQL half.
      return { row_no: r.row_no, contact_afm: r.counterparty_afm, contact_name: r.counterparty_name, ...rest };
    });
}

function ingestRows() {
  return aadeStagedToStageRows(staged).map((r) =>
    toIngestRowFields({
      ...r,
      projectId: PARITY_ASSIGNMENT.projectId,
      categoryId: PARITY_ASSIGNMENT.categoryId,
      accountId: PARITY_ASSIGNMENT.accountId,
    }),
  );
}

describe("AADE adapter", () => {
  it("classifies the fixture like the old importer", () => {
    expect(staged.map((s) => [s.rowNo, s.direction, s.counterpartyAfm, s.dedupStatus])).toEqual([
      [2, "expense", "111111111", "new"],
      [3, "income", "222222222", "new"],
      [4, "income", "333333333", "new"],
      [5, "expense", "111111111", "new"],
      [6, "expense", "444444444", "dup_in_batch"],
      [7, "expense", null, "dup_self_classification"],
      [8, "expense", "555555555", "new"],
      [9, "expense", "666666666", "new"],
      [10, "expense", null, "new"],
      [11, "expense", "777777777", "new"],
    ]);
  });

  it("maps decisions, dedup statuses and the AADE-only fields", () => {
    const rows = aadeStagedToStageRows(staged);
    expect(rows.map((r) => r.decision)).toEqual([
      "create", "create", "create", "create", "skip", "skip", "create", "create", "create", "create",
    ]);
    expect(rows[4].dedupStatus).toBe("dup_in_file");
    expect(rows[4].meta?.aade_dedup_status).toBe("dup_in_batch");
    expect(rows[0]).toMatchObject({ externalKey: "400000000000001", status: "paid", hasInvoice: true, kind: "document" });
    expect(rows[1]).toMatchObject({ hasInvoice: false, amount: 1000 }); // R13: no VAT, no withholding
    expect(rows[3]).toMatchObject({ amount: 66, netAmount: 50, vatAmount: 12, otherTaxes: 3 }); // R11/R12
    expect(rows[9]).toMatchObject({ amount: 99.2 }); // gross ?? net + vat − wh
  });

  it("stages a credit note without an amount and skips it (R21)", () => {
    const [credit] = aadeStagedToStageRows(
      classifyAadeRows(
        [{ ...PARITY_ROWS[0], netAmount: -100, vatAmount: -24, grossAmount: -124, mydataMark: "400000000000099" }],
        PARITY_OWN_AFM,
      ),
    );
    expect(credit).toMatchObject({ amount: null, decision: "skip" });
    expect(credit.parseErrors).toContain(NEGATIVE_AMOUNT_ERROR);
  });

  it("reads period and kind from the file name", () => {
    expect(aadeFileMeta("2026-03_income.xlsx")).toEqual({ period: "2026-03", kind: "income" });
    expect(aadeFileMeta("export.xlsx")).toEqual({ period: null, kind: null });
  });

  if (process.env.PRINT_PARITY) {
    it("prints the parity blocks", () => {
      const block = (tag: string, rows: unknown[]) =>
        `$${tag}$[\n${rows.map((r) => JSON.stringify(r)).join(",\n")}\n]$${tag}$\n`;
      writeFileSync(process.env.PRINT_PARITY!, block("legacy", legacyRows()) + "\n" + block("ingest", ingestRows()));
    });
  } else {
    it("old path output == $legacy$ block of the pgTAP parity test", () => {
      expect(legacyRows()).toEqual(sqlBlock("legacy"));
    });
    it("new path output == $ingest$ block of the pgTAP parity test", () => {
      expect(ingestRows()).toEqual(sqlBlock("ingest"));
    });
  }
});
