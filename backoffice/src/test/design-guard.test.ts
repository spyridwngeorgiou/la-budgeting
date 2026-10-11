import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import baseline from "./design-guard.baseline.json";

// The design rules, enforced on ALL of src/app and src/components:
//   - square corners (rounded-full for dots and avatars is the one
//     exception, rounded-none is fine) and no shadows;
//   - colours only through tokens -- no raw #hex in a .tsx;
//   - type only on the scale (globals.css: text-display … text-eyebrow,
//     text-field for phone inputs): no Tailwind text-xs/sm/base/lg/xl/2xl…,
//     no arbitrary text-[…] sizes, no font-mono (Inter only);
//   - one page title: <h1> only inside ui/PageHeader;
//   - one table: <table> only inside components/ui (SpecTable, DataTable).
//
// An unavoidable exception goes in design-guard.baseline.json as
// "path:rule": allowed count, so it is reviewed rather than silent.

const SRC = path.resolve(import.meta.dirname, "..");
const GUARDED = ["app", "components"];

const RULES: { name: string; re: RegExp; except?: (rel: string) => boolean }[] = [
  { name: "rounded", re: /rounded-(?!full|none)[\w[\]-]+/g },
  { name: "shadow", re: /(?:shadow|drop-shadow|inset-shadow)-[\w[\]/-]+/g },
  { name: "hex", re: /#[0-9a-fA-F]{3,8}/g },
  { name: "text-size", re: /(?<![\w-])(?:[\w@[\]-]+:)*text-(?:xs|sm|base|lg|xl|[2-9]xl)(?![\w-])/g },
  { name: "text-arbitrary", re: /(?<![\w-])(?:[\w@[\]-]+:)*text-\[[^\]]*\]/g },
  { name: "font-mono", re: /font-mono/g },
  // The public landing page has its own cover title (no app chrome).
  { name: "h1", re: /<h1[\s>]/g, except: (rel) => rel === "components/ui/PageHeader.tsx" || rel === "app/landing/Landing.tsx" },
  { name: "table", re: /<table[\s>]/g, except: (rel) => rel.startsWith("components/ui/") },
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
        if (rule.except?.(rel)) continue;
        const hits = text.match(rule.re);
        if (hits) out[`${rel}:${rule.name}`] = hits;
      }
    }
  }
  return out;
}

// Reading every guarded file takes a few seconds on a cold Windows/CI disk.
describe("design guard", { timeout: 30_000 }, () => {
  it("scans the guarded folders", () => {
    expect(walk(path.join(SRC, "components/ui")).length).toBeGreaterThan(10);
    expect(walk(path.join(SRC, "app")).length).toBeGreaterThan(100);
  });

  it("no new rounded corners, shadows, raw hex, off-scale type, raw titles or tables", () => {
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
