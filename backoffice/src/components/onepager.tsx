import Link from "next/link";
import type { ReactNode } from "react";
import { formatMoney } from "@/lib/format";

// The three-column grammar the Q004 workbook already proved: label on the
// left, the figure right-aligned in tabular figures, and the long Greek note
// that says WHY the figure is what it is. Those notes are not decoration --
// «35.000 πληρώθηκαν 30/07 ΧΩΡΙΣ ΤΙΜΟΛΟΓΙΟ» is the most important thing on
// that page.
//
// P15: no cards. A section is a title over a hairline, then spec-sheet rows
// with hairlines between them and an ink rule over a total.

export function OnePagerSection({
  title,
  subtitle,
  actions,
  children,
}: {
  title: string;
  subtitle?: ReactNode;
  // The section's own buttons («+ Δάνειο», «Επεξεργασία παραδοχών»), right
  // of the title: always visible, always in the same place.
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="flex min-w-0 break-inside-avoid flex-col gap-2">
      <div className="flex flex-col gap-1 border-b border-hairline pb-2.5">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <h2 className="text-section font-normal text-ink">{title}</h2>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
        {subtitle && <p className="text-small text-muted">{subtitle}</p>}
      </div>
      <div>{children}</div>
    </section>
  );
}

// `negative` shows a number with its minus sign (a cost or a shortfall)
// instead of a colour. `alert` marks a true exception (over budget, a
// negative margin) with the 2px severity bar; a `negative` text figure
// (a DSCR under the covenant, the breach years) is always one.
export function OnePagerRow({
  label,
  amount,
  note,
  emphasis,
  negative,
  alert,
  href,
  suffix,
}: {
  // A string, or a <Term> for jargon (NPV, DSCR).
  label: ReactNode;
  amount?: number | string | null;
  note?: string | null;
  emphasis?: boolean;
  negative?: boolean;
  alert?: boolean;
  href?: string;
  suffix?: string;
}) {
  const rendered = typeof amount === "string" ? amount : amount == null ? "—" : formatMoney(amount);
  const exception = Boolean(alert || (negative && typeof amount === "string"));

  const figure = (
    <span
      className={`num ${emphasis ? "text-body font-medium" : "text-body"} ${exception ? "text-negative" : "text-ink"}`}
    >
      {negative && typeof amount === "number" && amount !== 0 ? `−${formatMoney(Math.abs(amount))}` : rendered}
      {suffix}
    </span>
  );

  return (
    <div
      className={`grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-4 py-2 sm:grid-cols-[minmax(0,1fr)_9rem_minmax(0,1.1fr)] ${
        emphasis ? "border-t border-ink" : "border-b border-hairline"
      } ${exception ? "border-l-2 border-l-negative pl-2.5" : ""}`}
    >
      <span className={`text-body ${emphasis ? "font-medium text-ink" : "text-text"}`}>{label}</span>
      <span className="text-right">
        {href ? (
          <Link href={href} className="underline-offset-4 hover:underline">
            {figure}
          </Link>
        ) : (
          figure
        )}
      </span>
      {note ? (
        <span className="col-span-2 text-small text-muted sm:col-span-1 sm:pl-2">{note}</span>
      ) : (
        <span className="hidden sm:block" />
      )}
    </div>
  );
}

// Severity as the 2px bar on the note's left edge, with its label above.
const SEVERITY_BAR = { info: "border-l-hairline", watch: "border-l-warning", urgent: "border-l-negative" } as const;
const SEVERITY_TEXT = { info: "text-muted", watch: "text-warning", urgent: "text-negative" } as const;
const SEVERITY_LABEL = { info: "Ενημέρωση", watch: "Προσοχή", urgent: "Επείγον" } as const;

export interface ProjectNote {
  id: string;
  kind?: "status" | "risk" | "action" | "milestone";
  severity: "info" | "watch" | "urgent";
  body: string;
  exposure_amount: number | null;
  due_date: string | null;
}

export function StatusNotes({
  notes,
  renderActions,
  footer,
}: {
  notes: ProjectNote[];
  // Optional per-note actions (edit/resolve buttons) -- kept out of this
  // component's own concerns so it stays a pure display piece for any
  // future read-only usage, while the project page can still make notes
  // directly editable instead of only reachable via the AI propose flow.
  renderActions?: (note: ProjectNote) => ReactNode;
  footer?: ReactNode;
}) {
  if (notes.length === 0) {
    return (
      <div className="flex flex-col gap-3">
        <p className="border-b border-hairline py-3 text-body text-muted">Καμία ανοιχτή σημείωση.</p>
        {footer}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col">
        {notes.map((n) => (
          <li key={n.id} className="border-b border-hairline py-3">
            <div className={`flex flex-col gap-1.5 border-l-2 pl-3 ${SEVERITY_BAR[n.severity]}`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-baseline gap-3">
                  <span className={`eyebrow ${SEVERITY_TEXT[n.severity]}`}>{SEVERITY_LABEL[n.severity]}</span>
                  {n.exposure_amount != null && (
                    <span className="num text-body text-ink">έκθεση {formatMoney(n.exposure_amount)}</span>
                  )}
                </div>
                {renderActions && <div className="flex flex-wrap items-center gap-2">{renderActions(n)}</div>}
              </div>
              <p className="text-body text-ink">{n.body}</p>
            </div>
          </li>
        ))}
      </ul>
      {footer}
    </div>
  );
}
