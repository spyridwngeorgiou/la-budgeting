import Link from "next/link";
import { buttonClass } from "./Button";

// The one pager: «Σελίδα 2 από 14 · 51–100 από 683 κινήσεις» with previous /
// next as plain links that keep every other query parameter, so a page is
// shareable like any filter. No hooks -- renders on the server.
//
//   <Pager page={2} pageSize={50} total={683} noun="κινήσεις"
//          basePath="/transactions" params={searchParams} label="Σελίδες κινήσεων" />

type Params = Record<string, string | string[] | undefined>;

// `page` and the one-shot `new` (open-the-form) flag never ride along.
const DROPPED = new Set(["page", "new"]);

export function pageHref(basePath: string, params: Params, page: number): string {
  const q = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (DROPPED.has(key) || value == null) continue;
    for (const v of Array.isArray(value) ? value : [value]) if (v !== "") q.append(key, v);
  }
  if (page > 1) q.set("page", String(page));
  const s = q.toString();
  return s ? `${basePath}?${s}` : basePath;
}

export function Pager({
  page,
  pageSize,
  total,
  noun,
  basePath,
  params,
  label,
}: {
  page: number;
  pageSize: number;
  total: number;
  // Plural, lower case: «κινήσεις».
  noun: string;
  basePath: string;
  params: Params;
  label: string;
}) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  if (pageCount <= 1) return null;
  const current = Math.min(Math.max(1, page), pageCount);
  return (
    <nav aria-label={label} className="flex flex-wrap items-center justify-between gap-3 text-small text-muted">
      <span>
        Σελίδα <span className="num text-ink">{current}</span> από <span className="num">{pageCount}</span> ·{" "}
        <span className="num">{(current - 1) * pageSize + 1}</span>–<span className="num">{Math.min(current * pageSize, total)}</span> από{" "}
        <span className="num">{total}</span> {noun}
      </span>
      <span className="flex gap-2">
        {current > 1 && (
          <Link href={pageHref(basePath, params, current - 1)} rel="prev" className={buttonClass("secondary", "sm")}>
            ‹ Προηγούμενη
          </Link>
        )}
        {current < pageCount && (
          <Link href={pageHref(basePath, params, current + 1)} rel="next" className={buttonClass("secondary", "sm")}>
            Επόμενη ›
          </Link>
        )}
      </span>
    </nav>
  );
}

// Where a list shows only the first N rows: say so, never cut silently.
// «Εμφανίζονται 50 από 312 · όλα →»; nothing when everything is shown.
export function ShownCount({ shown, total, href, linkLabel = "όλα →" }: { shown: number; total: number; href?: string; linkLabel?: string }) {
  if (total <= shown) return null;
  return (
    <p className="flex flex-wrap items-center gap-x-3 text-small text-muted">
      <span>
        Εμφανίζονται <span className="num text-ink">{shown}</span> από <span className="num">{total}</span>
      </span>
      {href && (
        <Link href={href} className="inline-flex min-h-11 items-center text-ink underline-offset-4 hover:underline">
          {linkLabel}
        </Link>
      )}
    </p>
  );
}
