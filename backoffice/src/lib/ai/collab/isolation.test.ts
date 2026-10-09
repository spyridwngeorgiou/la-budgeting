import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
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
