import Link from "next/link";
import { Badge } from "@/components/ui";
import { formatMoney } from "@/lib/format";

// The three-column grammar the Q004 workbook already proved: label on the
// left, the figure right-aligned and monospaced, and the long Greek note that
// says WHY the figure is what it is. Those notes are not decoration -- «35.000
// πληρώθηκαν 30/07 ΧΩΡΙΣ ΤΙΜΟΛΟΓΙΟ» is the most important thing on that page.

export function OnePagerSection({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="break-inside-avoid rounded-md border border-line bg-surface p-4">
      <h2 className="text-sm font-semibold tracking-wide text-ink">{title}</h2>
      {subtitle && <p className="mb-2 text-xs text-ink-faint">{subtitle}</p>}
      <div className={subtitle ? "" : "mt-2"}>{children}</div>
    </section>
  );
}

export function OnePagerRow({
  label,
  amount,
  note,
  emphasis,
  negative,
  href,
  suffix,
}: {
  label: string;
  amount?: number | string | null;
  note?: string | null;
  emphasis?: boolean;
  negative?: boolean;
  href?: string;
  suffix?: string;
}) {
  const rendered =
    typeof amount === "string" ? amount : amount == null ? "—" : formatMoney(amount);

  const figure = (
    <span
      className={`font-mono tabular-nums ${emphasis ? "text-base font-semibold" : "text-sm"} ${
        negative ? "text-red-ink" : ""
      }`}
    >
      {negative && typeof amount === "number" ? `(${formatMoney(Math.abs(amount))})` : rendered}
      {suffix}
    </span>
  );

  return (
    <div
      className={`grid grid-cols-[1fr_auto] items-baseline gap-x-4 py-1.5 sm:grid-cols-[minmax(0,1fr)_9rem_minmax(0,1.1fr)] ${
        emphasis ? "mt-1 border-t border-line-strong pt-2" : "border-t border-line/60"
      }`}
    >
      <span className={`text-sm ${emphasis ? "font-semibold" : "text-ink-muted"}`}>{label}</span>
      <span className="text-right">{href ? <Link href={href} className="hover:underline">{figure}</Link> : figure}</span>
      {note ? (
        <span className="col-span-2 text-xs text-ink-faint sm:col-span-1 sm:pl-2">{note}</span>
      ) : (
        <span className="hidden sm:block" />
      )}
    </div>
  );
}

const SEVERITY_TONE = { info: "neutral", watch: "amber", urgent: "red" } as const;
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
  renderActions?: (note: ProjectNote) => React.ReactNode;
  footer?: React.ReactNode;
}) {
  if (notes.length === 0) {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-sm text-ink-faint">Καμία ανοιχτή σημείωση.</p>
        {footer}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <ul className="flex flex-col gap-2">
        {notes.map((n) => (
          <li key={n.id} className="flex flex-col gap-1 border-t border-line/60 pt-2 first:border-0 first:pt-0">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={SEVERITY_TONE[n.severity]}>{SEVERITY_LABEL[n.severity]}</Badge>
                {n.exposure_amount != null && (
                  <span className="font-mono text-sm tabular-nums text-red-ink">
                    έκθεση {formatMoney(n.exposure_amount)}
                  </span>
                )}
              </div>
              {renderActions && <div className="flex items-center gap-1.5">{renderActions(n)}</div>}
            </div>
            <p className="text-sm text-ink">{n.body}</p>
          </li>
        ))}
      </ul>
      {footer}
    </div>
  );
}
