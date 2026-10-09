import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { ALLOWLIST } from "./allowlist";
import { toChangeCard } from "./changeCards";

// apply_agent_change() (0083) enforces the SQL copy of the allowlist;
// propose_change and the review UI use the TS one. They must be the same
// set of (table, column) pairs.
const migration = readFileSync(
  path.resolve(import.meta.dirname, "../../../supabase/migrations/0083_agent_changes_v2.sql"),
  "utf8",
);

function sqlPairs(): string[] {
  const stmt = /insert into agent_change_columns \(table_name, column_name\) values([\s\S]*?);/.exec(migration);
  if (!stmt) throw new Error("agent_change_columns insert not found in 0083");
  return [...stmt[1].matchAll(/\('(\w+)',\s*'(\w+)'\)/g)].map((m) => `${m[1]}.${m[2]}`).sort();
}

function tsPairs(): string[] {
  return Object.entries(ALLOWLIST)
    .flatMap(([table, spec]) => spec.editableFields.map((c) => `${table}.${c}`))
    .sort();
}

describe("allowlist parity (TS ALLOWLIST <-> agent_change_columns)", () => {
  it("has the same (table, column) pairs", () => {
    expect(sqlPairs()).toEqual(tsPairs());
  });

  it("has no duplicates on either side", () => {
    expect(new Set(sqlPairs()).size).toBe(sqlPairs().length);
    expect(new Set(tsPairs()).size).toBe(tsPairs().length);
  });

  it("never allows org_id, id or audit columns", () => {
    for (const pair of tsPairs()) {
      expect(pair).not.toMatch(/\.(id|org_id|created_at|updated_at|created_by)$/);
    }
  });

  it("makes every label field editable (needed for inserts)", () => {
    for (const spec of Object.values(ALLOWLIST)) {
      expect(spec.editableFields).toContain(spec.labelField);
    }
  });
});

describe("toChangeCard", () => {
  const base = {
    id: "c1",
    status: "pending",
    table_name: "contacts",
    reason: "διόρθωση",
    created_at: "2026-10-01T10:00:00Z",
  };

  it("shows only the changed fields of a v2 update", () => {
    const card = toChangeCard({
      ...base,
      operation: "update",
      before: { email: "a@x.gr" },
      after: { email: "b@x.gr" },
      changed_fields: ["email"],
    });
    expect(card.title).toBe("Επαφή · Ενημέρωση");
    expect(card.fields).toEqual([{ field: "email", before: "a@x.gr", after: "b@x.gr" }]);
  });

  it("diffs a legacy full-snapshot update over editable fields only", () => {
    const card = toChangeCard({
      ...base,
      operation: "update",
      before: { id: "r", name: "Α", phone: "1", updated_at: "x" },
      after: { id: "r", name: "Β", phone: "1", updated_at: "y" },
    });
    expect(card.fields.map((f) => f.field)).toEqual(["name"]);
  });

  it("lists conflicts and the revenue-plan action", () => {
    const conflict = toChangeCard({
      ...base,
      status: "conflict",
      operation: "update",
      before: { email: "a" },
      after: { email: "b" },
      changed_fields: ["email"],
      conflict: { email: { before: "a", current: "c", after: "b" } },
    });
    expect(conflict.conflict).toEqual([{ field: "email", before: "a", current: "c", after: "b" }]);

    const action = toChangeCard({
      ...base,
      status: "approved",
      operation: "action",
      action: "create_revenue_plan",
      table_name: "revenue_plans",
      before: null,
      after: { name: "Εκτίμηση" },
      result: { row_id: "11111111-1111-4111-8111-111111111111" },
    });
    expect(action.title).toBe("Νέα εκτίμηση εσόδων · Ενέργεια");
    expect(action.resultHref).toBe("/projects/revenue-plans/11111111-1111-4111-8111-111111111111");
  });

  it("shows a stored SQL error in Greek", () => {
    const card = toChangeCard({ ...base, status: "failed", operation: "insert", before: null, after: {}, error: "23502: null value" });
    expect(card.error).toBe("Λείπει υποχρεωτικό πεδίο.");
  });
});
