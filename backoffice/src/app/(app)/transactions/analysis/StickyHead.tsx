"use client";

import { useEffect, useRef, type ReactNode } from "react";

// The months table scrolls sideways inside its own frame, and that frame is
// then the head's scroll container: CSS `position: sticky` cannot pin the
// head to the page. So the head follows the page instead: while the
// table's top is above the viewport, every head cell is moved down by that
// much (one CSS variable, set at most once per frame), clamped to the
// table; sideways it still scrolls with the months. The first head cell
// stays above the pinned first column. Wrap the SpecTable (separate
// borders, so the head's rule moves with it).
export function StickyHead({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = ref.current;
    const table = root?.querySelector("table");
    const head = table?.querySelector("thead");
    if (!root || !table || !head) return;
    let raf = 0;
    const update = () => {
      raf = 0;
      const top = parseFloat(getComputedStyle(root).getPropertyValue("--sticky-top")) || 0;
      // The table, not the frame: the head never slides over the frame's
      // own sideways scrollbar (or makes it scroll down).
      const box = table.getBoundingClientRect();
      const y = Math.min(Math.max(0, top - box.top), Math.max(0, box.height - head.offsetHeight));
      root.style.setProperty("--head-y", `${Math.round(y)}px`);
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      cancelAnimationFrame(raf);
    };
  }, []);
  return (
    <div
      ref={ref}
      className="min-w-0 [&_thead_th]:relative [&_thead_th]:z-[2] [&_thead_th]:translate-y-(--head-y) [&_thead_th]:bg-canvas [&_thead_th:first-child]:z-[3]"
    >
      {children}
    </div>
  );
}
