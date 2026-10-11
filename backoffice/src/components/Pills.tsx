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
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={label}>
      <span className="eyebrow text-muted">{label}:</span>
      {options.map((o) => (
        <Link
          key={o.key}
          href={o.href}
          aria-current={o.key === active ? "true" : undefined}
          className={`inline-flex min-h-8 items-center border px-2.5 text-xs ${
            o.key === active ? "border-navy bg-navy text-panel-ink" : "border-chip-border text-muted hover:border-navy hover:text-ink"
          }`}
        >
          {o.label}
        </Link>
      ))}
    </div>
  );
}
