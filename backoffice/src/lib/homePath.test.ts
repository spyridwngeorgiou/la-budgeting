import { describe, expect, it } from "vitest";
import { DEFAULT_HOME_PATH, HOME_PATHS, isHomePath, resolveHomePath } from "./homePath";

describe("home path list", () => {
  it("has the tiles page plus the 8 pages of 0092_home_path.sql, each with a label", () => {
    expect(HOME_PATHS.map((h) => h.path)).toEqual([
      "/",
      "/dashboard",
      "/inbox",
      "/transactions",
      "/projects",
      "/calendar",
      "/planner",
      "/reports/cash",
      "/accounts",
    ]);
    for (const h of HOME_PATHS) expect(h.label.length).toBeGreaterThan(0);
  });

  it("accepts only listed paths", () => {
    expect(isHomePath("/inbox")).toBe(true);
    expect(isHomePath("/reports/cash")).toBe(true);
    for (const bad of ["", "/settings", "/inbox/", "https://evil.example", "//evil.example", "/INBOX", null, undefined, 3]) {
      expect(isHomePath(bad)).toBe(false);
    }
  });

  it("falls back to the tiles page", () => {
    expect(DEFAULT_HOME_PATH).toBe("/");
    expect(isHomePath("/")).toBe(true);
    expect(resolveHomePath("/calendar")).toBe("/calendar");
    expect(resolveHomePath(null)).toBe("/");
    expect(resolveHomePath("/nope")).toBe("/");
  });
});
