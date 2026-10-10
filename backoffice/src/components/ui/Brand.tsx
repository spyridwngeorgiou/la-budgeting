import { cn } from "./cn";

// The Kansha mark, painted in currentColor: the PNG (public/brand/
// logo-mark.png, from la_proposals/template/brand) is used as a CSS mask,
// so the same file is navy on the canvas and light on the navy panel.
export function LogoMark({ size = 28, className = "" }: { size?: number; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn("inline-block shrink-0 bg-current", className)}
      style={{
        width: size,
        height: size,
        maskImage: "url(/brand/logo-mark.png)",
        WebkitMaskImage: "url(/brand/logo-mark.png)",
        maskSize: "contain",
        WebkitMaskSize: "contain",
        maskRepeat: "no-repeat",
        WebkitMaskRepeat: "no-repeat",
        maskPosition: "center",
        WebkitMaskPosition: "center",
      }}
    />
  );
}

// The wordmark as live text (Inter, wide tracking, like the proposals'
// .wordmark), not an image: crisp at every size and selectable.
export function Wordmark({ className = "" }: { className?: string }) {
  return <span className={cn("text-sm font-semibold tracking-[0.38em] uppercase", className)}>Kansha</span>;
}

// Mark + wordmark, the rail's lockup. `compact` shows the mark only.
export function Brand({ compact = false, className = "" }: { compact?: boolean; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-3 text-navy", className)}>
      <LogoMark />
      {compact ? <span className="sr-only">Kansha</span> : <Wordmark className="text-ink" />}
    </span>
  );
}
