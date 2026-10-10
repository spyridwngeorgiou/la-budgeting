import Link from "next/link";
import type { ButtonHTMLAttributes, ComponentProps } from "react";
import { cn } from "./cn";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "ai" | "aiSolid";
export type ButtonSize = "sm" | "md";

// Navy is the only solid fill: the primary button is the one thing to press.
// Everything else is an outline or plain text. `ai` keeps the AI family
// recognisable (violet symbol and label, never a violet fill); `aiSolid` is
// the legacy "ready to run" AI action and now renders as a primary button.
const VARIANTS: Record<ButtonVariant, string> = {
  primary: "border border-navy bg-navy text-panel-ink hover:border-navy-strong hover:bg-navy-strong",
  secondary: "border border-chip-border text-ink hover:border-navy hover:bg-hover",
  ghost: "border border-transparent text-text hover:bg-hover hover:text-ink",
  danger: "border border-negative text-negative hover:bg-negative-tint",
  ai: "border border-ai-border text-ai hover:bg-ai-tint",
  aiSolid: "border border-navy bg-navy text-panel-ink hover:border-navy-strong hover:bg-navy-strong",
};

const SIZES: Record<ButtonSize, string> = {
  sm: "min-h-8 px-2.5 py-1 text-small",
  md: "min-h-10 px-4 py-2 text-sm",
};

export function buttonClass(variant: ButtonVariant = "primary", size: ButtonSize = "md", className = "") {
  return cn(
    "inline-flex items-center justify-center gap-1.5 font-medium whitespace-nowrap transition-colors disabled:pointer-events-none disabled:opacity-50",
    VARIANTS[variant],
    SIZES[size],
    className,
  );
}

export function Button({
  variant = "primary",
  size = "md",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return <button className={buttonClass(variant, size, className)} {...props} />;
}

// A link that looks like a button (navigation, not an action).
export function ButtonLink({
  variant = "secondary",
  size = "md",
  className = "",
  ...props
}: ComponentProps<typeof Link> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return <Link className={buttonClass(variant, size, className)} {...props} />;
}

// Small consistent glyph prefixed onto every AI-triggered label/heading --
// the one visual cue tying chat, Kansha Entry, suggestions and insight
// panels together as "the same feature family".
export function AiSpark({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" className={cn("inline-block h-3.5 w-3.5", className)} aria-hidden="true">
      <path d="M8 0c.3 2.7 1.1 4.5 2.4 5.6C11.5 6.9 13.3 7.7 16 8c-2.7.3-4.5 1.1-5.6 2.4C9.1 11.5 8.3 13.3 8 16c-.3-2.7-1.1-4.5-2.4-5.6C4.5 9.1 2.7 8.3 0 8c2.7-.3 4.5-1.1 5.6-2.4C6.9 4.5 7.7 2.7 8 0z" />
    </svg>
  );
}
