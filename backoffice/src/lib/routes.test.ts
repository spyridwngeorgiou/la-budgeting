import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { LEGACY_REDIRECTS } from "./redirects";
import { SECTION_TABS } from "./navigation";

// Every internal link the code builds must land on a real page (or route
// handler), or on one of the configured legacy redirects. Catches links left
// behind when a page moves.

const SRC = path.resolve(import.meta.dirname, "..");
const APP = path.join(SRC, "app");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

// page.tsx / route.ts under src/app, route groups dropped, [param] -> one
// segment, [...rest] -> one or more.
const routePatterns: RegExp[] = walk(APP)
  .filter((f) => /[\\/](page\.tsx|route\.ts)$/.test(f))
  .map((f) => {
    const segments = path
      .relative(APP, path.dirname(f))
      .split(path.sep)
      .filter((s) => s && !/^\(.*\)$/.test(s));
    const re = segments
      .map((s) => (/^\[\.\.\..+\]$/.test(s) ? "/.+" : /^\[.+\]$/.test(s) ? "/[^/]+" : `/${s.replace(/[.*+?^$()|\\]/g, "\\$&")}`))
      .join("");
    return new RegExp(`^${re || "/"}$`);
  });

const redirectPatterns: RegExp[] = LEGACY_REDIRECTS.map(
  (r) => new RegExp(`^${r.source.replace(/:[a-z]+\*/gi, ".*").replace(/:[a-z]+/gi, "[^/]+")}$`),
);

function resolves(url: string): boolean {
  const pathname = url.split(/[?#]/)[0].replace(/\/$/, "") || "/";
  return routePatterns.some((re) => re.test(pathname)) || redirectPatterns.some((re) => re.test(pathname));
}

// href="/x", href={"/x"}, href={`/x/${id}`}, href: "/x", redirect("/x"),
// router.push/replace("/x"), revalidatePath("/x").
const LINK_RE =
  /(?:href\s*=\s*\{?\s*|href:\s*|redirect\(\s*|permanentRedirect\(\s*|router\.(?:push|replace)\(\s*|revalidatePath\(\s*)(["'`])(\/[^"'`]*)\1/g;

function collectLinks(): { file: string; url: string }[] {
  const out: { file: string; url: string }[] = [];
  for (const file of walk(SRC)) {
    if (!/\.(tsx?|mts)$/.test(file) || file.endsWith(".test.ts")) continue;
    const text = readFileSync(file, "utf8");
    for (const m of text.matchAll(LINK_RE)) {
      // `${…}` inside a path stands for one dynamic segment.
      const url = m[2].replace(/\$\{[^}]*\}/g, "x");
      out.push({ file: path.relative(SRC, file), url });
    }
  }
  return out;
}

describe("internal links", () => {
  const links = collectLinks();

  it("finds the links (the scanner itself works)", () => {
    expect(links.length).toBeGreaterThan(50);
    expect(links.some((l) => l.url.startsWith("/transactions"))).toBe(true);
  });

  it("every href/redirect/revalidatePath points at a real route or a legacy redirect", () => {
    const broken = links.filter((l) => !resolves(l.url)).map((l) => `${l.file}: ${l.url}`);
    expect(broken).toEqual([]);
  });

  it("every section tab is a real page", () => {
    const tabs = Object.values(SECTION_TABS).flat();
    expect(tabs.filter((t) => !routePatterns.some((re) => re.test(t.href)))).toEqual([]);
  });

  it("every legacy redirect lands on a real page", () => {
    for (const r of LEGACY_REDIRECTS) {
      expect(resolves(r.destination.replace(/:[a-z]+/gi, "x")), r.destination).toBe(true);
      // and the old path itself no longer has a page shadowing the redirect
      const old = r.source.replace(/:[a-z]+/gi, "x");
      expect(routePatterns.some((re) => re.test(old)), r.source).toBe(false);
    }
  });
});
