import { PageHeader } from "@/components/ui";
import { el } from "@/lib/i18n/el";
import { plannerContext } from "../planner/context";
import { CalendarView } from "./CalendarView";

// Ημερολόγιο: payments, receipts, VAT/withholding, instalments, milestones,
// phases and tasks of one month, with the planner's source filters and month
// navigation (?month=, ?src=, ?fin=0, ?project=).
export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const ctx = await plannerContext(params);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={el.planner.tabs.calendar} />
      <CalendarView ctx={ctx} params={params} />
    </div>
  );
}
