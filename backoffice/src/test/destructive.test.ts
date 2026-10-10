import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { destructiveRefusal, findDestructive, latestManifest } from "../../scripts/lib/destructive.mjs";

// The guard in scripts/migrate-remote.mjs.

describe("findDestructive", () => {
  it("finds deletes and drops", () => {
    expect(findDestructive("delete from liabilities where x;\nDROP  TABLE foo;")).toEqual(["delete from", "drop table"]);
    expect(findDestructive("alter table t drop column c; truncate t;")).toEqual(["drop column", "truncate"]);
  });
  it("ignores comments and harmless SQL", () => {
    expect(findDestructive("-- we never delete from x\n/* drop table y */\ncreate table z (id int);")).toEqual([]);
    expect(findDestructive("alter table t drop constraint c; drop index i; drop policy p on t;")).toEqual([]);
  });
});

describe("backups and refusal", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "kansha-backups-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const write = (stamp: string, m: object) => {
    mkdirSync(path.join(dir, "ref1", stamp), { recursive: true });
    writeFileSync(path.join(dir, "ref1", stamp, "manifest.json"), JSON.stringify(m));
  };
  write("a", { ref: "ref1", createdAt: "2026-10-09T08:00:00.000Z", complete: true, tables: {} });
  write("b", { ref: "ref1", createdAt: "2026-10-10T08:00:00.000Z", complete: true, tables: {} });
  write("c", { ref: "ref1", createdAt: "2026-10-10T09:00:00.000Z", complete: false, tables: {} });

  it("picks the newest complete manifest", () => {
    expect(latestManifest(dir, "ref1")?.createdAt).toBe("2026-10-10T08:00:00.000Z");
    expect(latestManifest(dir, "other")).toBeNull();
  });

  const now = Date.parse("2026-10-10T12:00:00.000Z");
  const manifest = latestManifest(dir, "ref1");
  it("lets non-destructive runs through", () => {
    expect(destructiveRefusal({ destructiveFiles: [], confirm: false, manifest: null, now })).toBeNull();
  });
  it("needs --confirm-destructive", () => {
    expect(destructiveRefusal({ destructiveFiles: ["0085.sql"], confirm: false, manifest, now })).toMatch(/confirm-destructive/);
  });
  it("needs a backup younger than 24h", () => {
    expect(destructiveRefusal({ destructiveFiles: ["0085.sql"], confirm: true, manifest: null, now })).toMatch(/no backup/);
    expect(
      destructiveRefusal({ destructiveFiles: ["0085.sql"], confirm: true, manifest, now: now + 24 * 3600 * 1000 }),
    ).toMatch(/old/);
    expect(destructiveRefusal({ destructiveFiles: ["0085.sql"], confirm: true, manifest, now })).toBeNull();
  });
});
