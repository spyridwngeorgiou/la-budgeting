import { Segmented, cn } from "@/components/ui";

// Shared look of the report tabs (P15 spec sheet). Only class strings and a
// view switch -- no data, no logic. The tables are hand-rolled (not
// DataTable) where a row is highlighted or a column is sticky; these keep
// them identical to DataTable: uppercase 12px head over the navy rule,
// hairline rows, numbers right-aligned in tabular figures.

// The frame a wide table scrolls inside (the page itself never scrolls sideways).
export const FRAME = "max-w-full overflow-x-auto";
export const TABLE = "w-full border-collapse text-left text-body";
export const TH = "eyebrow border-b border-rule bg-canvas px-3 py-2.5 text-left font-medium whitespace-nowrap text-muted";
export const TD = "border-b border-hairline px-3 py-3 align-top text-text";
export const NUM = "num text-right whitespace-nowrap";
// A list row in a section (no header): hairline under it.
export const ROW = "border-b border-hairline";
// Small action buttons: 44px tall on phones, compact from md up.
export const TOUCH = "max-md:min-h-11";
// A text link inside a table or a list.
export const LINK = "text-ink underline-offset-4 hover:underline";
// Secondary line under a cell's main text.
export const SUB = "block text-small text-muted";

// A labelled, mutually exclusive view option (scenario, year, grouping):
// eyebrow label over joined chips. Every option is a URL.
export function ViewSwitch({
  label,
  options,
  active,
}: {
  label: string;
  options: { key: string; label: string; href: string }[];
  active: string;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <span className="eyebrow text-muted">{label}</span>
      <Segmented label={label} options={options} active={active} className={cn("flex-wrap", "[&>a]:max-md:min-h-11")} />
    </div>
  );
}
