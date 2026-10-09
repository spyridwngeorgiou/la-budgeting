import { describe, expect, it } from "vitest";
import { boardTopic, collabStoragePath, isPartnerAllowedPath, safeNextPath } from "./paths";

describe("isPartnerAllowedPath", () => {
  it.each(["/collab", "/collab/abc", "/collab/abc/board/def", "/auth/confirm", "/api/collab/ai/chat", "/login"])(
    "allows %s",
    (p) => expect(isPartnerAllowedPath(p)).toBe(true),
  );
  it.each(["/dashboard", "/transactions", "/api/ai/chat", "/collabx", "/api/collabx", "/", "/projects/1"])(
    "blocks %s",
    (p) => expect(isPartnerAllowedPath(p)).toBe(false),
  );
});

describe("safeNextPath", () => {
  it("keeps same-origin relative paths", () => {
    expect(safeNextPath("/collab/123?x=1")).toBe("/collab/123?x=1");
  });
  it.each([null, "", "https://evil.com", "//evil.com", "/\\evil.com", "javascript:alert(1)", "collab", "/\nx"])(
    "falls back for %s",
    (n) => expect(safeNextPath(n, "/collab")).toBe("/collab"),
  );
});

describe("collabStoragePath", () => {
  it("builds four segments with a sanitised file name", () => {
    expect(collabStoragePath("o", "p", "b", "Κάτοψη ../v2.pdf")).toMatch(/^o\/p\/b\/_+v2\.pdf$/);
    const path = collabStoragePath("o", "p", "b", "a/b\\..c.png");
    expect(path.split("/")).toHaveLength(4);
    expect(path).not.toContain("..");
  });
});

describe("boardTopic", () => {
  it("matches the realtime policy format", () => {
    expect(boardTopic("00000000-0000-0000-0000-000000000001")).toBe("board:00000000-0000-0000-0000-000000000001");
  });
});
