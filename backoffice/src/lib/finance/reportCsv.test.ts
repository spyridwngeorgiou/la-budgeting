import { describe, expect, it } from "vitest";
import { toCsv } from "@/lib/csv";
import { pnlTable } from "./pnl";
import { cashCsv, netWorthCsv, pnlCsv } from "./reportCsv";

describe("pnlCsv", () => {
  it("one row per line (subtotals included), buckets then the total", () => {
    const buckets = ["2026-01", "2026-02"];
    const table = pnlTable(
      [
        { bucket: "2026-01", line: "revenue", amount: 1000 },
        { bucket: "2026-02", line: "opex", amount: "-300.004" },
      ],
      buckets,
    );
    const csv = pnlCsv(table, buckets, (b) => `M${b.slice(5)}`);
    expect(csv.header).toEqual(["Γραμμή", "M01", "M02", "Σύνολο"]);
    expect(csv.rows).toHaveLength(9);
    expect(csv.rows[0]).toEqual(["Έσοδα", 1000, 0, 1000]);
    expect(csv.rows.at(-1)).toEqual(["Αποτέλεσμα", 1000, -300, 700]);
  });
});

describe("cashCsv", () => {
  it("one row per month, the month as YYYY-MM", () => {
    const csv = cashCsv([
      {
        month: "2026-10-01",
        opening_balance: "5000",
        inflow: 1000.005,
        uncertain_inflow: 0,
        outflow: "250",
        net: 750,
        closing_balance: 5750,
        min_buffer: 6000,
        below_buffer: true,
      },
    ]);
    expect(csv.header[0]).toBe("Μήνας");
    expect(csv.rows).toEqual([["2026-10", 5000, 1000.01, 0, 250, 750, 5750, 6000, "Ναι"]]);
  });
});

describe("netWorthCsv", () => {
  it("each non-empty component's total and items, then the net worth", () => {
    const csv = netWorthCsv(
      ["cash", "assets", "loans"],
      { cash: 100, assets: 0, loans: -50 },
      [{ component: "loans", label: "Τράπεζα", owner_scope: "corporate", amount: 50 }],
      50,
    );
    expect(csv.header).toEqual(["Ενότητα", "Στοιχείο", "Πεδίο", "Ποσό"]);
    expect(csv.rows).toEqual([
      ["Ρευστά", "Σύνολο", "", 100],
      ["Δάνεια", "Σύνολο", "", -50],
      ["Δάνεια", "Τράπεζα", expect.any(String), 50],
      ["Καθαρή θέση", "", "", 50],
    ]);
  });

  it("goes through toCsv with the BOM", () => {
    const { header, rows } = netWorthCsv([], {}, [], 0);
    expect(toCsv(header, rows).startsWith("﻿Ενότητα,")).toBe(true);
  });
});
