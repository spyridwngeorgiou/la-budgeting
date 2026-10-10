// Join class names, skipping falsy ones: cn("a", cond && "b", undefined).
export function cn(...classes: (string | false | null | undefined | 0)[]): string {
  return classes.filter(Boolean).join(" ");
}
