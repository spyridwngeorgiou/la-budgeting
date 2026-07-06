import { cn } from "@/lib/utils";
import type { ComponentProps } from "react";

export function Card({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "rounded-xl border border-border bg-card shadow-sm",
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("px-5 pt-5 pb-2", className)} {...props} />;
}

export function CardTitle({ className, ...props }: ComponentProps<"h3">) {
  return (
    <h3
      className={cn("text-sm font-semibold text-foreground", className)}
      {...props}
    />
  );
}

export function CardContent({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("px-5 pb-5", className)} {...props} />;
}

export function Input({ className, ...props }: ComponentProps<"input">) {
  return (
    <input
      className={cn(
        "w-full rounded-lg border border-border bg-white px-3 py-2 text-sm outline-none",
        "focus:border-primary focus:ring-2 focus:ring-primary/20",
        className,
      )}
      {...props}
    />
  );
}

export function Select({ className, ...props }: ComponentProps<"select">) {
  return (
    <select
      className={cn(
        "w-full rounded-lg border border-border bg-white px-3 py-2 text-sm outline-none",
        "focus:border-primary focus:ring-2 focus:ring-primary/20",
        className,
      )}
      {...props}
    />
  );
}

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return (
    <textarea
      className={cn(
        "w-full rounded-lg border border-border bg-white px-3 py-2 text-sm outline-none",
        "focus:border-primary focus:ring-2 focus:ring-primary/20",
        className,
      )}
      {...props}
    />
  );
}

export function Label({ className, ...props }: ComponentProps<"label">) {
  return (
    <label
      className={cn("mb-1 block text-xs font-medium text-muted", className)}
      {...props}
    />
  );
}

type ButtonProps = ComponentProps<"button"> & {
  variant?: "primary" | "secondary" | "danger" | "ghost";
};

export function Button({
  className,
  variant = "primary",
  ...props
}: ButtonProps) {
  const variants: Record<string, string> = {
    primary: "bg-primary text-primary-fg hover:bg-primary/90",
    secondary: "bg-white border border-border text-foreground hover:bg-slate-100",
    danger: "bg-negative text-white hover:bg-negative/90",
    ghost: "text-muted hover:bg-slate-100",
  };
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition disabled:opacity-50",
        variants[variant],
        className,
      )}
      {...props}
    />
  );
}

const BADGE_STYLES: Record<string, string> = {
  paid: "bg-positive/15 text-positive",
  upcoming: "bg-warning/15 text-warning",
  planned: "bg-slate-100 text-slate-700",
  income: "bg-positive/15 text-positive",
  expense: "bg-negative/12 text-negative",
  active: "bg-primary/15 text-primary",
  completed: "bg-positive/15 text-positive",
  on_hold: "bg-slate-100 text-slate-700",
};

export function Badge({
  tone,
  children,
}: {
  tone: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex rounded-full px-2 py-0.5 text-xs font-medium",
        BADGE_STYLES[tone] ?? "bg-slate-100 text-slate-600",
      )}
    >
      {children}
    </span>
  );
}
