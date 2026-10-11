import { Tabs } from "@/components/ui";
import { ReportTools } from "@/components/PresentMode";
import { el } from "@/lib/i18n/el";
import { SECTION_TABS } from "@/lib/navigation";
import { ExportCsvLink } from "./ExportCsvLink";

// The reports section: the same tabs, as the P15 tab strip (navy underline
// on the active tab) with «Παρουσίαση» and «Εκτύπωση / PDF» beside it
// (under it on a phone) -- and «Εξαγωγή CSV» on the tabs that have one --
// then the tab's page.
export default function ReportsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex min-w-0 flex-wrap items-end gap-x-4 gap-y-3">
        <Tabs tabs={SECTION_TABS.reports} label={el.nav.reports} className="min-w-0 max-md:basis-full md:flex-1" />
        <span className="inline-flex flex-wrap items-center gap-2 print-hide">
          <ExportCsvLink />
          <ReportTools />
        </span>
      </div>
      {children}
    </div>
  );
}
