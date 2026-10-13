import { Tabs } from "@/components/ui";
import { el } from "@/lib/i18n/el";
import { SECTION_TABS } from "@/lib/navigation";

// The reports section: the six tabs, as the P15 tab strip (navy underline
// on the active tab), then the tab's page. Each page carries its own
// «Εξαγωγή CSV» (in its header) and its own footer line with the quality
// checks that touch its figures. The reports only read: what they show is
// managed on its own pages (Λογαριασμοί → Περιουσία, Αναμενόμενα έσοδα).
export default function ReportsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <Tabs tabs={SECTION_TABS.reports} label={el.nav.reports} className="min-w-0" />
      {children}
    </div>
  );
}
