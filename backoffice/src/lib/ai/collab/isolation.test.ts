import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

// Static guard for the board assistant's isolation (Stage 2b): the code a
// partner's request runs must never name a finance table or view, nor reach
// for an elevated Supabase client or the back-office assistant's tools. RLS
// would refuse a partner anyway; this keeps the code from even trying, and
// fails review-proof the day someone "just adds" a ledger lookup here.

const root = path.resolve(import.meta.dirname, "../../..");
const FILES = [
  "lib/ai/collab/tools.ts",
  "lib/ai/collab/prompt.ts",
  "lib/ai/collab/boardText.ts",
  "lib/ai/collab/proposals.ts",
  "lib/ai/collab/skeletons.ts",
  "app/api/collab/ai/chat/route.ts",
  "app/(collab)/collab/[projectId]/ai-actions.ts",
];

const FORBIDDEN: [string, RegExp][] = [
  ["transactions table", /transactions/i],
  ["accounts table", /accounts/i],
  ["contacts table", /contacts/i],
  ["a v_* view", /["'`]v_/],
  ["service role", /service[_-]?role/i],
  ["the admin client module", /supabase\/admin/],
  ["the back-office assistant tools", /lib\/ai\/(tools|writeTools|revenuePlanTools|prompts)["']/],
  ["the org-wide ai_usage table directly", /from\(["']ai_usage["']\)/],
];

describe("board assistant isolation", () => {
  for (const rel of FILES) {
    const source = readFileSync(path.join(root, rel), "utf8");
    for (const [what, pattern] of FORBIDDEN) {
      it(`${rel} never references ${what}`, () => {
        expect(source).not.toMatch(pattern);
      });
    }
  }

  it("the route uses the RLS-scoped server client", () => {
    const route = readFileSync(path.join(root, "app/api/collab/ai/chat/route.ts"), "utf8");
    expect(route).toMatch(/from "@\/lib\/supabase\/server"/);
    expect(route).toMatch(/can_access_project/);
  });
});

// Both directions, by import: the board assistant may use only the shared
// client and the neutral lib/ai/shared/* helpers (fence), and nothing in
// the back-office finance assistant may import the board assistant. The
// shared helpers themselves import from neither side.
function walk(dir: string): string[] {
  return readdirSync(path.join(root, dir)).flatMap((name) => {
    const rel = path.posix.join(dir, name);
    if (statSync(path.join(root, rel)).isDirectory()) return walk(rel);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.ts$/.test(name) ? [rel] : [];
  });
}

function imports(rel: string): string[] {
  const source = readFileSync(path.join(root, rel), "utf8");
  return [...source.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)].map((m) => m[1]);
}

const COLLAB_FILES = [...walk("lib/ai/collab"), ...walk("app/api/collab"), ...walk("app/(collab)")];
const FINANCE_FILES = [
  ...readdirSync(path.join(root, "lib/ai"))
    .filter((n) => /\.ts$/.test(n) && !/\.test\.ts$/.test(n))
    .map((n) => `lib/ai/${n}`),
  ...walk("app/api/ai"),
  ...walk("app/(app)/assistant"),
];
const SHARED_FILES = walk("lib/ai/shared");

describe("finance assistant <-> board assistant isolation", () => {
  it("finds the files it guards", () => {
    expect(COLLAB_FILES.length).toBeGreaterThan(5);
    expect(FINANCE_FILES).toContain("lib/ai/tools.ts");
    expect(FINANCE_FILES).toContain("app/api/ai/chat/route.ts");
    expect(SHARED_FILES).toContain("lib/ai/shared/fence.ts");
  });

  for (const rel of COLLAB_FILES) {
    it(`${rel} imports from lib/ai only the client, shared helpers or collab`, () => {
      for (const spec of imports(rel)) {
        if (spec.startsWith("@/lib/ai/")) expect(spec).toMatch(/^@\/lib\/ai\/(client|shared\/|collab\/)/);
        if (rel.startsWith("lib/ai/collab/") && spec.startsWith("../")) expect(spec).toMatch(/^\.\.\/shared\//);
      }
    });
  }

  for (const rel of FINANCE_FILES) {
    it(`${rel} never imports the board assistant`, () => {
      for (const spec of imports(rel)) expect(spec).not.toMatch(/(^|\/)collab(\/|$)/);
    });
  }

  for (const rel of SHARED_FILES) {
    it(`${rel} imports neither assistant`, () => {
      for (const spec of imports(rel)) expect(spec).not.toMatch(/lib\/ai\/(?!shared\/)|^\.\.\//);
    });
  }
});
