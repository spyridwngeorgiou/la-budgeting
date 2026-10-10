import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { color, contrast, CONTRAST_PAIRS, cssName, type ColorToken } from "./tokens";

// The palette passes WCAG where it is used, and tokens.ts (charts, /design)
// says the same as globals.css (everything else).

const css = readFileSync(path.resolve(import.meta.dirname, "../../app/globals.css"), "utf8");
const cssVars = new Map([...css.matchAll(/--color-([a-z-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim().toLowerCase()]));

describe("contrast()", () => {
  it("matches the WCAG reference values", () => {
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrast("#ffffff", "#ffffff")).toBeCloseTo(1, 5);
    expect(contrast("#777777", "#ffffff")).toBeCloseTo(4.48, 2);
  });
});

describe("WCAG pairs", () => {
  it.each(CONTRAST_PAIRS.map((p) => [`${p.fg} on ${p.bg} (${p.use})`, p] as const))("%s", (_, p) => {
    expect(contrast(color[p.fg], color[p.bg])).toBeGreaterThanOrEqual(p.min);
  });

  it("every text colour is checked on the canvas", () => {
    const onCanvas = new Set(CONTRAST_PAIRS.filter((p) => p.bg === "canvas").map((p) => p.fg));
    for (const t of ["ink", "text", "muted", "accentInk", "positive", "negative", "warning", "ai"] as ColorToken[]) {
      expect(onCanvas.has(t), t).toBe(true);
    }
  });
});

describe("tokens.ts and globals.css agree", () => {
  it.each(Object.keys(color) as ColorToken[])("%s", (token) => {
    const norm = (v: string | undefined) => v?.replace(/\s/g, "").toLowerCase();
    expect(norm(cssVars.get(cssName(token))), `--color-${cssName(token)}`).toBe(norm(color[token]));
  });

  it("ink-faint is gone as a colour of its own (it failed contrast)", () => {
    expect(cssVars.get("ink-faint")).toBe(color.muted);
  });

  it("no radius and no shadow", () => {
    for (const m of css.matchAll(/--radius[a-z0-9-]*:\s*([^;]+);/g)) expect(m[1].trim()).toBe("0");
    for (const m of css.matchAll(/--(?:inset-|drop-)?shadow[a-z0-9-]*:\s*([^;]+);/g)) expect(m[1].trim()).toBe("0 0 #0000");
  });
});
