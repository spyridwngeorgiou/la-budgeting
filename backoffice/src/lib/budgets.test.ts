import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import budgets from "./budgets.json";
import { NAV_V2, SETTINGS_V2, navForRole } from "./navigation";

// The redesign's guard rails (see budgets.json): the menu stays at five
// destinations plus Settings, the number of (app) pages never grows, each
// destination's code stays within its line budget, and src/features holds
// components only -- routes live in src/app.

const SRC = path.resolve(import.meta.dirname, "..");

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const lines = (file: string) => readFileSync(file, "utf8").split("\n").length;

describe("navigation budget", () => {
  it(`at most ${budgets.navMax} destinations, plus Settings`, () => {
    expect(NAV_V2.length).toBeLessThanOrEqual(budgets.navMax);
    expect(NAV_V2.some((d) => d.href === SETTINGS_V2.href)).toBe(false);
    expect(new Set(NAV_V2.map((d) => d.key)).size).toBe(NAV_V2.length);
  });

  it("partners see only Έργα and Πλάνο", () => {
    expect(navForRole("partner").map((d) => d.key)).toEqual(["projects", "planner"]);
  });

  it("every destination points at a real page", () => {
    const pages = walk(path.join(SRC, "app"))
      .filter((f) => f.endsWith(`${path.sep}page.tsx`))
      .map((f) =>
        `/${path
          .relative(path.join(SRC, "app"), path.dirname(f))
          .split(path.sep)
          .filter((s) => s && !/^\(.*\)$/.test(s))
          .join("/")}`,
      );
    for (const href of [...NAV_V2.flatMap((d) => [d.href, d.partnerHref ?? d.href]), SETTINGS_V2.href]) {
      expect(pages, href).toContain(href);
    }
  });
});

describe("page budget", () => {
  const appPages = walk(path.join(SRC, "app", "(app)")).filter((f) => f.endsWith(`${path.sep}page.tsx`));

  it(`(app) has at most ${budgets.appPagesMax} pages (target ${budgets.appPagesTarget})`, () => {
    expect(appPages.length).toBeLessThanOrEqual(budgets.appPagesMax);
  });

  it("no page.tsx (or route.ts / layout.tsx) under src/features", () => {
    const routes = walk(path.join(SRC, "features")).filter((f) => /[\/](page|route|layout)\.tsx?$/.test(f));
    expect(routes.map((f) => path.relative(SRC, f))).toEqual([]);
  });
});

describe("destination line budgets", () => {
  it.each(Object.entries(budgets.destinationLoc))("src/features/%s ≤ %i lines", (dest, max) => {
    const total = walk(path.join(SRC, "features", dest))
      .filter((f) => /\.(tsx?|css)$/.test(f) && !/\.test\.tsx?$/.test(f))
      .reduce((n, f) => n + lines(f), 0);
    expect(total).toBeLessThanOrEqual(max);
  });
});
