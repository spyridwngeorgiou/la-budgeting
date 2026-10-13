import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";
import { cn } from "./cn";

// Form controls: white field, 1px field-border (3:1 against field and
// canvas), square, navy border on focus. One height (40px) so inputs,
// selects and buttons line up in a row.
const CONTROL =
  "min-h-10 border border-field-border bg-field px-3 py-2 text-body text-ink placeholder:text-muted focus:border-navy focus:outline-none disabled:bg-hover disabled:text-muted aria-[invalid=true]:border-negative max-md:text-field";

export function Input({ className = "", ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(CONTROL, className)} {...props} />;
}

// An amount: decimal keypad on phones, right-aligned tabular figures, € after.
export function MoneyInput({
  className = "",
  currency = "€",
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & { currency?: string }) {
  return (
    <span className={cn("relative inline-flex", className)}>
      <input type="text" inputMode="decimal" autoComplete="off" className={cn(CONTROL, "num w-full pr-8 text-right")} {...props} />
      <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-body text-muted">
        {currency}
      </span>
    </span>
  );
}

export function Select({ className = "", children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cn(CONTROL, "pr-8", className)} {...props}>
      {children}
    </select>
  );
}

export function Textarea({ className = "", ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(CONTROL, "min-h-24", className)} {...props} />;
}

export function Checkbox({
  label,
  className = "",
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & { label: ReactNode }) {
  return (
    <label className={cn("inline-flex min-h-10 cursor-pointer items-center gap-2 text-body text-ink", className)}>
      <input type="checkbox" className="h-4 w-4 accent-navy" {...props} />
      {label}
    </label>
  );
}

export function Label({
  children,
  className = "",
  title,
  htmlFor,
}: {
  children: ReactNode;
  className?: string;
  title?: string;
  htmlFor?: string;
}) {
  return (
    <label
      htmlFor={htmlFor}
      className={cn(
        "mb-1 block text-small font-medium text-muted",
        title && "cursor-help underline decoration-dotted underline-offset-2",
        className,
      )}
      title={title}
    >
      {children}
    </label>
  );
}

// A labelled control. The old form (<Field><Label/><Input/></Field>) still
// works; the new one takes label / hint / error as props. `required` puts a
// «*» after the label (the control keeps its own `required` attribute);
// pass `htmlFor` = the control's id so a click on the label focuses it.
export function Field({
  children,
  label,
  hint,
  error,
  htmlFor,
  required = false,
  className = "",
}: {
  children: ReactNode;
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  htmlFor?: string;
  required?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col", className)}>
      {label && (
        <Label htmlFor={htmlFor}>
          {label}
          {required && (
            <span aria-hidden="true" className="ml-0.5 text-negative">
              *
            </span>
          )}
        </Label>
      )}
      {children}
      {hint && !error && <p className="mt-1 text-small text-muted">{hint}</p>}
      {error && (
        <p role="alert" className="mt-1 text-small text-negative">
          {error}
        </p>
      )}
    </div>
  );
}

// Inline definition-on-hover for jargon/acronyms (DSCR, ADR, opex, ...);
// the dotted underline shows on hover only, so a column of terms stays calm.
export function Term({ title, children }: { title: string; children: ReactNode }) {
  return (
    <span title={title} className="cursor-help decoration-dotted underline-offset-2 hover:underline">
      {children}
    </span>
  );
}
