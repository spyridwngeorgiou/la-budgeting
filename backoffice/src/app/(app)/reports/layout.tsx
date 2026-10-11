import { Tabs } from "@/components/ui";
import { el } from "@/lib/i18n/el";
import { SECTION_TABS } from "@/lib/navigation";
import { ExportCsvLink } from "./ExportCsvLink";

// The reports section: the same tabs, as the P15 tab strip (navy underline
// on the active tab), «Εξαγωγή CSV» under it on the tabs that have one,
// then the tab's page.
export default function ReportsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex min-w-0 flex-wrap items-end gap-x-4 gap-y-3">
        {/* The tabs get their own full row: seven of them don't fit beside the export. */}
        <Tabs tabs={SECTION_TABS.reports} label={el.nav.reports} className="min-w-0 basis-full" />
        <span className="ml-auto inline-flex flex-wrap items-center gap-2">
          <ExportCsvLink />
        </span>
      </div>
      {children}
    </div>
  );
}
