import { Tabs } from "@/components/ui";
import { el } from "@/lib/i18n/el";
import { SECTION_TABS } from "@/lib/navigation";

// The reports section: the same six tabs, as the P15 tab strip (navy
// underline on the active tab), then the tab's page.
export default function ReportsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <Tabs tabs={SECTION_TABS.reports} label={el.nav.reports} />
      {children}
    </div>
  );
}
