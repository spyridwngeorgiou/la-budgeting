import { describe, expect, it } from "vitest";
import { parseUiVersion, resolveUiVersion } from "./versionCore";

describe("resolveUiVersion", () => {
  it("prefers a valid cookie", () => {
    expect(resolveUiVersion("v2", "app", { UI_DEFAULT: "v1" })).toBe("v2");
    expect(resolveUiVersion("v1", "collab", { COLLAB_UI_DEFAULT: "v2" })).toBe("v1");
  });
  it("falls back to the scope's env default", () => {
    expect(resolveUiVersion(undefined, "app", { UI_DEFAULT: "v2", COLLAB_UI_DEFAULT: "v1" })).toBe("v2");
    expect(resolveUiVersion(undefined, "collab", { UI_DEFAULT: "v2", COLLAB_UI_DEFAULT: "v1" })).toBe("v1");
  });
  it("ignores junk and defaults to v1", () => {
    expect(resolveUiVersion("v3", "app", { UI_DEFAULT: "yes" })).toBe("v1");
    expect(resolveUiVersion(undefined, "app", {})).toBe("v1");
  });
  it("parses only v1 / v2", () => {
    expect(parseUiVersion("v2")).toBe("v2");
    expect(parseUiVersion("V2")).toBeNull();
    expect(parseUiVersion(null)).toBeNull();
  });
});
