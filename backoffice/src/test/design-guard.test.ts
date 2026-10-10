import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import baseline from "./design-guard.baseline.json";

// The design rules, enforced on the restyled code (src/components/ui,
// src/components/planner, src/components/collab): square corners (rounded-full for
// dots and avatars is the one exception, rounded-none is fine), no
// shadows, and colours only through tokens -- no raw #hex in a .tsx.
// The classic pages are left alone; they get the look through the aliases
// in globals.css.
//
// An unavoidable exception goes in design-guard.baseline.json as
// "path:rule": allowed count, so it is reviewed rather than silent.

const SRC = path.resolve(import.meta.dirname, "..");
// Phase 6 added the planner and the collaboration pieces (the Excalidraw
// scene's own colours live in .ts files, which are not scanned).
const GUARDED = ["components/ui", "components/planner", "components/collab"];

const RULES: { name: string; re: RegExp }[] = [
  { name: "rounded", re: /\brounded-(?!full\b|none\b)[\w[\]-]+/g },
  { name: "shadow", re: /\b(?:shadow|drop-shadow|inset-shadow)-[\w[\]/-]+/g },
  { name: "hex", re: /#[0-9a-fA-F]{3,8}\b/g },
];

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (full.endsWith(".tsx")) out.push(full);
  }
  return out;
}

export function violations(): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const dir of GUARDED) {
    for (const file of walk(path.join(SRC, dir))) {
      const rel = path.relative(SRC, file).split(path.sep).join("/");
      // Strip comments so the rules can be explained in prose.
      const text = readFileSync(file, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/(^|[^:])\/\/.*$/gm, "$1");
      for (const rule of RULES) {
        const hits = text.match(rule.re);
        if (hits) out[`${rel}:${rule.name}`] = hits;
      }
    }
  }
  return out;
}

describe("design guard", () => {
  it("scans the guarded folders", () => {
    expect(walk(path.join(SRC, "components/ui")).length).toBeGreaterThan(10);
  });

  it("no new rounded corners, shadows or raw hex colours", () => {
    const allowed = baseline as Record<string, number>;
    const found = violations();
    const fresh = Object.entries(found)
      .filter(([key, hits]) => hits.length > (allowed[key] ?? 0))
      .map(([key, hits]) => `${key}: ${hits.join(", ")}`);
    expect(fresh).toEqual([]);
  });

  it("the baseline only shrinks (no stale entries)", () => {
    const found = violations();
    const stale = Object.entries(baseline as Record<string, number>)
      .filter(([key, n]) => (found[key]?.length ?? 0) < n)
      .map(([key]) => key);
    expect(stale).toEqual([]);
  });
});
