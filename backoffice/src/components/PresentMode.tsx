"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Button, LogoMark, Wordmark, buttonClass, cn } from "@/components/ui";
import { formatDate } from "@/lib/format";
import { todayAthens } from "@/lib/dates";
import { report } from "@/lib/i18n/v2/report";
import { PRESENT_STEPS, carriesPresent, isPresenting, presentNeighbours, withPresent, withoutPresent } from "@/lib/present";

// Presentation mode and print, for showing the app to owners, advisers,
// investors. Only a view: nothing is removed, «Έξοδος» returns to the
// normal page.
//
//   ?present=1 renders the slim top bar below (logo, ← n/N →, «Έξοδος
//   παρουσίασης»). Its [data-present-on] marker is in the server HTML, so
//   globals.css can hide `.present-hide` (edit buttons, «⋯» menus, «＋»,
//   «Ρωτήστε», internal notices, the side menu) and enlarge the type via
//   :root:has([data-present-on]) with no flash; <html data-present> is set
//   too, for scripts and older selectors.
//   While active, every in-app link and GET form keeps ?present=1; ← → (and
//   PageUp/PageDown) step through the overview and the report tabs, Escape
//   leaves.
//
// Mounted once by the (app) shell (Nav), inside <Suspense>.
export function PresentMode() {
  const search = useSearchParams();
  const pathname = usePathname() ?? "";
  const router = useRouter();
  const on = isPresenting(search);
  const steps = presentNeighbours(pathname);
  const prev = steps?.prev ?? null;
  const next = steps?.next ?? null;
  const exitHref = withoutPresent(pathname, search?.toString() ?? "");

  useEffect(() => {
    if (!on) return;
    const root = document.documentElement;
    root.setAttribute("data-present", "");

    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || a.hasAttribute("download") || a.hasAttribute("data-present-exit") || (a.target && a.target !== "_self")) return;
      const url = new URL(a.href, window.location.href);
      if (url.origin !== window.location.origin || !carriesPresent(url.pathname) || isPresenting(url.searchParams)) return;
      // Ahead of next/link's own handler: navigate with the flag instead.
      e.preventDefault();
      e.stopPropagation();
      router.push(withPresent(`${url.pathname}${url.search}${url.hash}`));
    };
    const onSubmit = (e: SubmitEvent) => {
      const form = e.target as HTMLFormElement | null;
      if (!form || (form.method || "get").toLowerCase() !== "get" || form.querySelector('input[name="present"]')) return;
      const input = document.createElement("input");
      input.type = "hidden";
      input.name = "present";
      input.value = "1";
      form.appendChild(input);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t?.closest?.("input, textarea, select, [contenteditable=''], [contenteditable='true'], dialog[open]")) return;
      if (e.key === "Escape") {
        router.push(exitHref);
        return;
      }
      if (!prev || !next) return;
      if (e.key === "ArrowRight" || e.key === "PageDown") router.push(withPresent(next));
      else if (e.key === "ArrowLeft" || e.key === "PageUp") router.push(withPresent(prev));
      else return;
      e.preventDefault();
    };
    document.addEventListener("click", onClick, true);
    document.addEventListener("submit", onSubmit, true);
    document.addEventListener("keydown", onKey);
    return () => {
      root.removeAttribute("data-present");
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("submit", onSubmit, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [on, prev, next, exitHref, router]);

  if (!on) return null;
  const arrow = "inline-flex min-h-10 min-w-10 items-center justify-center border border-chip-border text-ink hover:border-navy hover:bg-hover";
  return (
    <div
      data-present-on=""
      className="print-hide fixed inset-x-0 top-0 z-40 flex h-topbar items-center justify-between gap-3 border-b border-hairline bg-canvas px-4 md:px-8"
    >
      <span className="inline-flex items-center gap-3 text-navy">
        <LogoMark />
        <Wordmark className="text-ink max-sm:hidden" />
      </span>
      <nav aria-label={report.present.nav} className="flex items-center gap-2">
        {steps && (
          <>
            <Link href={withPresent(steps.prev)} aria-label={report.present.prev} className={arrow}>
              <span aria-hidden="true">←</span>
            </Link>
            <span className="num min-w-12 text-center text-small text-muted">
              {steps.index + 1} / {PRESENT_STEPS.length}
            </span>
            <Link href={withPresent(steps.next)} aria-label={report.present.next} className={arrow}>
              <span aria-hidden="true">→</span>
            </Link>
          </>
        )}
        <Link href={exitHref} data-present-exit="" className={buttonClass("secondary", "sm", "ml-2")}>
          {report.present.exit}
        </Link>
      </nav>
    </div>
  );
}

// «Παρουσίαση»: the current page with ?present=1 (filters kept). For the
// Overview, the Reports layout and the project page header.
export function PresentButton({ className = "" }: { className?: string }) {
  const pathname = usePathname() ?? "";
  const search = useSearchParams();
  const query = search?.toString() ?? "";
  return (
    <Link
      href={withPresent(query ? `${pathname}?${query}` : pathname)}
      className={buttonClass("secondary", "md", cn("present-hide print-hide", className))}
    >
      {report.present.start}
    </Link>
  );
}

// «Εκτύπωση / PDF»: the browser's print dialog (save as PDF there). The
// print styles (globals.css) do the rest. Stays visible while presenting.
export function PrintButton({ className = "" }: { className?: string }) {
  return (
    <Button type="button" variant="secondary" onClick={() => window.print()} className={cn("print-hide", className)}>
      {report.print.button}
    </Button>
  );
}

// Both buttons, for a page header's actions.
export function ReportTools({ className = "" }: { className?: string }) {
  return (
    <span className={cn("inline-flex flex-wrap items-center gap-2 print-hide", className)}>
      <PresentButton />
      <PrintButton />
    </span>
  );
}

// The navy strip at the top of every printed page (hidden on screen):
// brand mark, the page's title, today's date, «Εμπιστευτικό». Before
// printing it also opens every folded <details> (phone tables, «Πώς
// υπολογίζεται»), and folds them back after.
export function PrintHeader() {
  const [title, setTitle] = useState("");
  const [date, setDate] = useState("");

  useEffect(() => {
    const read = () => {
      setTitle(document.querySelector("main h1")?.textContent?.trim() || document.title);
      setDate(formatDate(todayAthens()));
    };
    let opened: HTMLDetailsElement[] = [];
    const before = () => {
      read();
      opened = Array.from(document.querySelectorAll<HTMLDetailsElement>("main details:not([open])"));
      opened.forEach((d) => (d.open = true));
    };
    const after = () => {
      opened.forEach((d) => (d.open = false));
      opened = [];
    };
    read();
    window.addEventListener("beforeprint", before);
    window.addEventListener("afterprint", after);
    return () => {
      window.removeEventListener("beforeprint", before);
      window.removeEventListener("afterprint", after);
    };
  }, []);

  return (
    <div aria-hidden="true" className="print-only print-strip items-center justify-between gap-6 bg-panel px-6 py-3 text-panel-ink">
      <span className="inline-flex items-center gap-3">
        <LogoMark size={22} />
        <Wordmark className="text-panel-ink" />
        {title && <span className="text-body text-panel-ink">· {title}</span>}
      </span>
      <span className="inline-flex items-center gap-4 text-small text-panel-muted">
        <span className="num">{date}</span>
        <span className="eyebrow text-panel-ink">{report.print.confidential}</span>
      </span>
    </div>
  );
}
