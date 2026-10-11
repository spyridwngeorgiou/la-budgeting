"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { cn } from "./cn";

// A <details> that is open on a desktop and folds on a phone: rendered
// open (so the server HTML and a desktop show everything), closed once on
// mount below md. The content stays server-rendered children; nothing is
// rendered twice. Printing opens it again (components/PresentMode).
export function PhoneDetails({
  summary,
  children,
  className = "",
}: {
  summary: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (window.matchMedia("(max-width: 767px)").matches) ref.current?.removeAttribute("open");
  }, []);
  return (
    <details ref={ref} open className={cn("group flex min-w-0 flex-col", className)}>
      {summary}
      {children}
    </details>
  );
}
