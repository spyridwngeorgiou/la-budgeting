import { Tabs } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrgId } from "@/lib/supabase/org";
import { el } from "@/lib/i18n/el";
import { SECTION_TABS } from "@/lib/navigation";
import { ALL_RELIABILITY_CODES } from "@/lib/finance/insights";
import { ExportCsvLink } from "./ExportCsvLink";
import { ReliabilityLine } from "./ReliabilityLine";

// The reports section: the same tabs, as the P15 tab strip (navy underline
// on the active tab), under it the tab's reliability line (the open quality
// checks that touch its figures) and «Εξαγωγή CSV» on the tabs that have
// one, then the tab's page. The reports only read: what they show is
// managed on its own pages (Λογαριασμοί → Περιουσία, Αναμενόμενα έσοδα).
export default async function ReportsLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const orgId = await getCurrentOrgId(supabase);
  // One query for the whole section: a layout is kept when switching tabs.
  const { data: worklist } = await supabase
    .from("v_worklist")
    .select("code, count, href")
    .eq("org_id", orgId)
    .in("code", ALL_RELIABILITY_CODES);

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex min-w-0 flex-wrap items-end gap-x-4 gap-y-3">
        {/* The tabs get their own full row: seven of them don't fit beside the export. */}
        <Tabs tabs={SECTION_TABS.reports} label={el.nav.reports} className="min-w-0 basis-full" />
        <ReliabilityLine rows={worklist ?? []} />
        <span className="ml-auto inline-flex flex-wrap items-center gap-2">
          <ExportCsvLink />
        </span>
      </div>
      {children}
    </div>
  );
}
