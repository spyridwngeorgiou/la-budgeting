import Link from "next/link";

// A row of link "pills" for a page's view options (scenario, year, grouping).
// Every option is a URL, so the choice is shareable and survives a reload.
export function Pills({
  label,
  options,
  active,
}: {
  label: string;
  options: { key: string; label: string; href: string }[];
  active: string;
}) {
  return (
    <div className="flex items-center gap-1.5" role="group" aria-label={label}>
      <span className="text-xs text-ink-muted">{label}:</span>
      {options.map((o) => (
        <Link
          key={o.key}
          href={o.href}
          aria-current={o.key === active ? "true" : undefined}
          className={`rounded border px-2 py-0.5 text-xs ${
            o.key === active ? "border-ink bg-ink text-white" : "border-line text-ink-muted hover:border-line-strong hover:text-ink"
          }`}
        >
          {o.label}
        </Link>
      ))}
    </div>
  );
}
